import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { UserPlus, ExternalLink, Info } from "lucide-react";
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
        <a
          href="https://base44.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button className="gap-2 self-start sm:self-auto">
            <UserPlus className="h-4 w-4" /> Invite Users
            <ExternalLink className="h-3 w-3 opacity-70" />
          </Button>
        </a>
      </div>

      {/* Invite instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1">How to invite new users</p>
          <p className="text-blue-700 text-xs leading-relaxed">
            To invite someone, go to your <strong>Base44 Dashboard → Overview → Send Invites</strong>, enter their email, choose Admin or User role, and click Send Invitation. They'll receive an email to create their account and sign in. <strong>Do not use any other method</strong> — inviting via the dashboard is the only way to ensure their account is properly created.
          </p>
        </div>
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