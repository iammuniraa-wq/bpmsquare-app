// BPMSquare mobile — a native app shell wrapping the existing BPMSquare web
// app in a platform WebView. This is the fastest correct path to a single
// Android + iOS codebase without duplicating the whole product natively:
// the web app is the source of truth, this shell adds what a browser tab
// can't (a home-screen icon, offline handling, native back navigation,
// and a foundation to layer push notifications / biometric unlock onto
// later without another rewrite).
//
// BPMSquare resolves tenant identity from the HOSTNAME (bpmsquarecore.md),
// not a login-time picker — so this app asks once, on first launch, which
// workspace address to open (e.g. "acme.bpmsquare.app"), stores it, and
// every launch after that goes straight to the WebView. A partner building
// ONE branded app for a single customer can skip the picker entirely by
// passing --dart-define=BPM_BASE_URL=https://that-customer.bpmsquare.app
// at build time — see mobile/README.md.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'bpm_workspace_url';
const _buildTimeUrl = String.fromEnvironment('BPM_BASE_URL', defaultValue: '');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(statusBarColor: Color(0xFF152233)),
  );
  runApp(const BpmSquareApp());
}

class BpmSquareApp extends StatelessWidget {
  const BpmSquareApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BPMSquare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1E3A6E),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFF152233),
      ),
      home: const _Root(),
    );
  }
}

/// Decides, on cold start, whether a workspace URL is already known
/// (build-time constant, or a previous run's saved choice) and routes to
/// either the picker or straight to the WebView shell.
class _Root extends StatefulWidget {
  const _Root();

  @override
  State<_Root> createState() => _RootState();
}

class _RootState extends State<_Root> {
  String? _url;
  bool _loadedPrefs = false;

  @override
  void initState() {
    super.initState();
    _resolveStartUrl();
  }

  Future<void> _resolveStartUrl() async {
    if (_buildTimeUrl.isNotEmpty) {
      setState(() {
        _url = _normalize(_buildTimeUrl);
        _loadedPrefs = true;
      });
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _url = prefs.getString(_prefsKey);
      _loadedPrefs = true;
    });
  }

  String _normalize(String raw) {
    var u = raw.trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://$u';
    return u;
  }

  Future<void> _saveAndOpen(String raw) async {
    final url = _normalize(raw);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, url);
    setState(() => _url = url);
  }

  @override
  Widget build(BuildContext context) {
    if (!_loadedPrefs) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: Colors.white)));
    }
    if (_url == null) {
      return _WorkspacePicker(onSubmit: _saveAndOpen);
    }
    return _WebShell(startUrl: _url!);
  }
}

/// First-launch (or "switch workspace") screen — the mobile equivalent of
/// typing a tenant's hostname into a browser's address bar.
class _WorkspacePicker extends StatefulWidget {
  const _WorkspacePicker({required this.onSubmit});
  final ValueChanged<String> onSubmit;

  @override
  State<_WorkspacePicker> createState() => _WorkspacePickerState();
}

class _WorkspacePickerState extends State<_WorkspacePicker> {
  final _controller = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.hub_outlined, color: Colors.white, size: 56),
                  const SizedBox(height: 18),
                  const Text(
                    'BPMSquare',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Enter your workspace address',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 14),
                  ),
                  const SizedBox(height: 28),
                  TextFormField(
                    controller: _controller,
                    autocorrect: false,
                    keyboardType: TextInputType.url,
                    textInputAction: TextInputAction.go,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'yourcompany.bpmsquare.app',
                      hintStyle: const TextStyle(color: Colors.white38),
                      filled: true,
                      fillColor: Colors.white.withValues(alpha: 0.06),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your workspace address' : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _submit,
                    style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                    child: const Text('Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      widget.onSubmit(_controller.text);
    }
  }
}

/// The actual app: a full-screen WebView with a loading bar, an
/// offline/error state with Retry, native Android back-button handling
/// (goes back in web history before exiting the app), and external-scheme
/// links (tel:, mailto:, whatsapp:, upi:, PDF/file downloads) handed off
/// to the OS instead of failing silently inside the WebView.
class _WebShell extends StatefulWidget {
  const _WebShell({required this.startUrl});
  final String startUrl;

  @override
  State<_WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<_WebShell> {
  late final WebViewController _controller;
  double _progress = 0;
  bool _hasError = false;
  bool _offline = false;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF152233))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (p) => setState(() => _progress = p / 100),
          onPageStarted: (_) => setState(() => _hasError = false),
          onWebResourceError: (_) => setState(() => _hasError = true),
          onNavigationRequest: (request) async {
            final uri = Uri.tryParse(request.url);
            if (uri == null) return NavigationDecision.navigate;
            // Same-app navigation: let the WebView handle it.
            if (uri.scheme == 'http' || uri.scheme == 'https') {
              return NavigationDecision.navigate;
            }
            // Everything else (tel:, mailto:, whatsapp:, upi:, intent:, ...)
            // is a job for the OS, not the WebView.
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return NavigationDecision.prevent;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.startUrl));

    _connSub = Connectivity().onConnectivityChanged.listen((result) {
      final offline = result.every((r) => r == ConnectivityResult.none);
      if (offline != _offline) setState(() => _offline = offline);
    });
  }

  @override
  void dispose() {
    _connSub?.cancel();
    super.dispose();
  }

  Future<bool> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false; // handled -- don't exit the app
    }
    return true; // nothing to go back to -- let the system handle it (exit)
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _handleBack()) {
          if (context.mounted) SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF152233),
        body: SafeArea(
          child: Stack(
            children: [
              if (!_offline) WebViewWidget(controller: _controller),
              if (_progress < 1 && !_hasError && !_offline)
                Positioned(
                  top: 0, left: 0, right: 0,
                  child: LinearProgressIndicator(
                    value: _progress,
                    minHeight: 2,
                    backgroundColor: Colors.transparent,
                    color: const Color(0xFF1E3A6E),
                  ),
                ),
              if (_offline || _hasError) _ErrorState(
                offline: _offline,
                onRetry: () => _controller.reload(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.offline, required this.onRetry});
  final bool offline;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF152233),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
            color: Colors.white70, size: 44,
          ),
          const SizedBox(height: 14),
          Text(
            offline ? "You're offline" : "Couldn't load BPMSquare",
            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            offline ? 'Check your connection and try again.' : 'Something went wrong loading the page.',
            style: const TextStyle(color: Colors.white60, fontSize: 13),
          ),
          const SizedBox(height: 18),
          OutlinedButton(
            onPressed: onRetry,
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: const BorderSide(color: Colors.white38),
            ),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
