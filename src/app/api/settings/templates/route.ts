import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("text_fragments")
    .select("*")
    .order("category")
    .order("label");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { label, category, text } = body;
  if (!label || !category || !text) {
    return NextResponse.json({ error: "label, category and text are required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("text_fragments")
    .insert({ label, category, text })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
