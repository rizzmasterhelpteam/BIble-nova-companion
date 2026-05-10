import { getApiStatus } from "../server-api";

export function GET() {
  return Response.json(getApiStatus());
}
