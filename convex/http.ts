import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { oneClickOptOut } from "./invites";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/invites/unsubscribe", method: "POST", handler: oneClickOptOut });

export default http;
