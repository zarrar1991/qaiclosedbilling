import React, { useState } from "react";
import { Sidebar, type Page } from "./components/Sidebar.js";
import { Renewal } from "./pages/Renewal.js";
import { FullDowngrade } from "./pages/FullDowngrade.js";
import { Settings } from "./pages/Settings.js";

export default function App() {
  const [page, setPage] = useState<Page>("renewal");
  return (
    <div className="flex h-screen">
      <Sidebar page={page} setPage={setPage} />
      <main className="flex-1 overflow-auto p-8">
        {page === "renewal" && <Renewal />}
        {page === "full" && <FullDowngrade />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
