// Smoke test: the app boots and shows the first-launch workspace picker
// (no workspace saved yet in a fresh test environment) without throwing.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:bpmsquare/main.dart';

void main() {
  testWidgets('App boots to the workspace picker on first launch', (WidgetTester tester) async {
    // Deterministic "no workspace saved yet" -- without this, the plugin's
    // platform channel has no test-time backing and the lookup never
    // resolves at all.
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(const BpmSquareApp());
    // Not pumpAndSettle() -- the initial "loading prefs" state shows an
    // indeterminate CircularProgressIndicator, which animates forever and
    // would make pumpAndSettle() time out by design. A couple of explicit
    // pumps is enough for the SharedPreferences lookup to resolve.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('BPMSquare'), findsOneWidget);
    expect(find.text('Enter your workspace address'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Continue'), findsOneWidget);
  });
}
