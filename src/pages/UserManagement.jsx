import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { UserPlus, Shield, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

const ROLES = ["admin", "production_manager", "inventory_manager", "fulfillment_driver", "sales_rep", "compliance_manager", "viewer"];

const roleStyle = {
  admin: "bg-purple-50 text-purple-700",
  production_manager: "bg-blue-50 text-blue-700",
  inventory_manager: "bg-amber-50 text-amber-700",
  fulfillment_driver: "bg-cyan-50 text-cyan-700",
  sales_rep: "bg-emerald-50 text-emerald-700",
  compliance_manager: "bg-orange-50 text-orange-700",
  viewer: "bg-gray-50 text-gray-600",
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [editingDept, setEditingDept] = useState(null);

  useEffect(() => {
    base44.entities.User.list('-created_date', 200)
      .then(data => {
        setUsers(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load users');
        setLoading(false);
      });
  }, []);

  const updateRole = async (userId, newRole) => {
    const originalRole = users.find(u => u.id === userId)?.role;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    setUpdatingId(userId);
    try {
      await base44.entities.User.update(userId, { role: newRole });
    } catch (error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: originalRole } : u));
    }
    setUpdatingId(null);
  };

  const updateDepartment = async (userId, newDept) => {
    const originalDept = users.find(u => u.id === userId)?.department;
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, department: newDept } : u));
    setEditingDept(userId);
    try {
      await base44.entities.User.update(userId, { department: newDept });
    } catch (error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, department: originalDept } : u));
    }
    setEditingDept(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">Failed to load users</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
          <p className="text-muted-foreground text-sm mt-3">You may need admin privileges to view this page.</p>
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
            if (email) base44.users.inviteUser(email, "viewer").then(() => alert("Invite sent!"));
          }}
        >
          <UserPlus className="h-4 w-4" /> Invite User
        </Button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-2">
        {ROLES.map(r => (
          <span key={r} className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleStyle[r]}`}>
            {r === "admin" && <Shield className="h-3 w-3 inline mr-1" />}
            {r.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Name", "Email", "Role", "Department", "Joined"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h === "Department" ? "Department (click to edit)" : h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold flex-shrink-0">
                        {user.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?"}
                      </div>
                      <span className="font-medium text-sm text-foreground">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.email}</td>
                  <td className="px-5 py-3.5">
                    <div className="relative inline-block">
                      <select
                        value={user.role || "viewer"}
                        onChange={e => updateRole(user.id, e.target.value)}
                        disabled={updatingId === user.id}
                        className={`pl-2.5 pr-6 py-1 rounded-full text-xs font-medium border-0 cursor-pointer appearance-none ${roleStyle[user.role] || "bg-gray-50 text-gray-600"}`}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-50" />
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <input
                      type="text"
                      value={user.department || ""}
                      onChange={(e) => updateDepartment(user.id, e.target.value)}
                      placeholder="Add department"
                      disabled={editingDept === user.id}
                      className="px-2 py-1 text-sm text-foreground bg-transparent border border-border rounded hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors w-32"
                    />
                  </td>
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