import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

export default function Settings() {
  const { user } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await base44.asServiceRole.entities.User.delete(user.id);
      base44.auth.logout();
    } catch (error) {
      alert("Error deleting account: " + error.message);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Account Info */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Account Information</h2>
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</p>
            <p className="text-sm text-foreground mt-1">{user?.full_name || "N/A"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</p>
            <p className="text-sm text-foreground mt-1">{user?.email || "N/A"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</p>
            <p className="text-sm text-foreground mt-1">{user?.role || "viewer"}</p>
          </div>
        </div>
      </div>

      {/* Delete Account */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-red-900 mb-2">Delete Account</h2>
            <p className="text-sm text-red-800 mb-4">
              This action is permanent and cannot be undone. All your data will be deleted.
            </p>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-2"
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
              Delete My Account
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Confirm Account Deletion</h3>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete your account? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
                disabled={deleting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1"
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}