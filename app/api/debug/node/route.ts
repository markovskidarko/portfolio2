export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';

// Intentionally does NOT import the DB to stay usable when native addons fail.
export async function GET() {
  return NextResponse.json({
    node: process.version,
    abi: process.versions.modules,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
  });
}


