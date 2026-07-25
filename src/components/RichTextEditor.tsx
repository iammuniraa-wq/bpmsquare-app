"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { c } from "@/lib/theme";

const btn = (active: boolean): React.CSSProperties => ({
  border: "none", background: active ? c.accentbg : "transparent",
  color: active ? c.accent : c.muted, borderRadius: 5,
  width: 26, height: 24, fontSize: 12.5, fontWeight: 700,
  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
});

export default function RichTextEditor({
  value, onChange, placeholder, minHeight = 80,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    // Disabled nodes match the toolbar exactly (no heading/blockquote/code/strike
    // buttons) -- keeps the HTML this can produce narrow, which is also what
    // lib/sanitizeHtml.ts's allowlist is built against.
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false, strike: false, code: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Tiptap only reads `content` on mount -- sync in external changes (e.g.
  // inserting a text-fragment template) without fighting the user's own typing.
  // The `false` skips emitting another onUpdate, since this update IS what
  // value already reflects.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel }}>
      <div style={{ display: "flex", gap: 2, padding: "4px 6px", borderBottom: `1px solid ${c.line}` }}>
        <button type="button" title="Bold" style={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
        <button type="button" title="Italic" style={{ ...btn(editor.isActive("italic")), fontStyle: "italic" }} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
        <span style={{ width: 1, background: c.line, margin: "3px 4px" }} />
        <button type="button" title="Bullet list" style={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
        <button type="button" title="Numbered list" style={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
      </div>
      <EditorContent
        editor={editor}
        style={{ padding: "8px 12px", fontSize: 13, lineHeight: 1.6, color: c.ink, minHeight }}
      />
      <style>{`
        .tiptap { outline: none; }
        .tiptap p { margin: 0 0 6px; }
        .tiptap p:last-child { margin-bottom: 0; }
        .tiptap ul, .tiptap ol { margin: 0 0 6px; padding-left: 22px; }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${c.hint};
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
