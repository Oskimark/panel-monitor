import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";

export function middleware(req: NextRequest) {
  if (isAuthorized(req.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Panel de infraestructura"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
