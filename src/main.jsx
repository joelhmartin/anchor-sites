import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AdminApp } from "./admin/AdminApp.tsx";
import "./index.css";

// D1290: the SPA entry renders the Studio admin app ONLY. The pre-pivot
// Brainfood marketing/auth/app tree is deleted — tenant sites are
// server-rendered (src/server/routes/page.ts), so any host that falls
// through to the SPA fallback gets the admin shell's login gate.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AdminApp />
    </BrowserRouter>
  </StrictMode>,
);
