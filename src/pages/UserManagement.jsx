import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { UserPlus, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.User.list().then(data => {
      setUsers(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">User Management</h1>
          <p className="text-muted-foreground mt-1">{users.length} registered users</p>
        </div>
        <Button className="gap-2"><UserPlus className="h-4 w-4" /> Invite User</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Name", "Email", "Role", "Joined"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold flex-shrink-0">
                        {user.full_name?.split(" ").map(n => n[0]).join("") || "?"}
                      </div>
                      <span className="font-medium text-sm text-foreground">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${user.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700"}`}>
                      {user.role === "admin" && <Shield className="h-3 w-3" />}
                      {user.role || "user"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">
                    {moment(user.created_date).format("MMM D, YYYY")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}