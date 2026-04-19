import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadUsers() {
      try {
        const res = await base44.functions.invoke('getUsers', {});
        setUsers(res.data.users || []);
      } catch (err) {
        console.error('Failed to load users:', err);
        setError(err.message || 'Failed to load users');
      }
      setLoading(false);
    }
    loadUsers();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">Error loading users</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">User Management</h1>
          <p className="text-muted-foreground mt-1">{users.length} registered users</p>
        </div>
        <Button
          className="gap-2 self-start sm:self-auto"
          onClick={() => {
            const email = prompt("Enter user email to invite:");
            if (email) base44.users.inviteUser(email, "user").then(() => alert("Invite sent!"));
          }}
        >
          <UserPlus className="h-4 w-4" /> Invite User
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Name", "Email", "Title", "Phone", "Joined"].map(h => (
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
                        {(user.full_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </div>
                      <span className="font-medium text-sm text-foreground">{user.full_name || "Unknown"}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.email || "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.title || "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.phone || "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{moment(user.created_date).format("MMM D, YYYY")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}