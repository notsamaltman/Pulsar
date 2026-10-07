export async function GET() {
  return Response.json({
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlLength: process.env.DATABASE_URL?.length ?? 0,
    runtime: process.env.NEXT_RUNTIME,
  });
}