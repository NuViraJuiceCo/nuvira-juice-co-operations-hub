import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-56 min-h-screen transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-[1440px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}