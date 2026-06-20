import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("pricing_items")
    .select("*")
    .order("category")
    .order("description");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { category, description, unit, rate, notes } = body;
  if (!category || !description || !unit) {
    return NextResponse.json({ error: "category, description and unit are required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("pricing_items")
    .insert({ category, description, unit, rate: rate ?? 0, notes: notes ?? null })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
