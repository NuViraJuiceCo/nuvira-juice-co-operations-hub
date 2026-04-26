import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Trash2, AlertTriangle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/AuthContext";

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    display_name: "",
    title: "",
    phone: "",
    bio: ""
  });

  useEffect(() => {
    if (user) {
      setFormData({
        display_name: user.display_name || user.full_name || "",
        title: user.title || "",
        phone: user.phone || "",
        bio: user.bio || ""
      });
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.auth.updateMe(formData);
      await refreshUser();
      setEditing(false);
    } catch (error) {
      alert("Error saving profile: " + error.message);
    }
    setSaving(false);
  };

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
    <div className="space-y-6 w-full max-w-2xl px-0 sm:px-0">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Account Info */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Profile Information</h2>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        
        {editing ? (
          <div className="space-y-4">
            <div>
             <label htmlFor="display_name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
             <input
               type="text"
               id="display_name"
               value={formData.display_name}
               onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
               placeholder="Display name"
               className="w-full px-3 py-2 mt-1 rounded-lg border border-input bg-background text-sm"
             />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
              <p className="text-sm text-foreground mt-1">{user?.email}</p>
            </div>
            <div>
             <label htmlFor="title" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Job Title</label>
             <input
               type="text"
               id="title"
               value={formData.title}
               onChange={(e) => setFormData({ ...formData, title: e.target.value })}
               placeholder="e.g. Operations Manager"
               className="w-full px-3 py-2 mt-1 rounded-lg border border-input bg-background text-sm"
             />
            </div>
            <div>
             <label htmlFor="phone" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</label>
             <input
               type="tel"
               id="phone"
               value={formData.phone}
               onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
               placeholder="e.g. +1 (555) 123-4567"
               className="w-full px-3 py-2 mt-1 rounded-lg border border-input bg-background text-sm"
             />
            </div>
            <div>
              <label htmlFor="bio" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bio</label>
              <textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Tell us about yourself..."
                className="w-full px-3 py-2 mt-1 rounded-lg border border-input bg-background text-sm"
                rows="3"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="gap-2 flex-1"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</p>
              <p className="text-sm text-foreground mt-1">{formData.display_name || user?.full_name || "N/A"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</p>
              <p className="text-sm text-foreground mt-1">{user?.email || "N/A"}</p>
            </div>
            {formData.title && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Job Title</p>
                <p className="text-sm text-foreground mt-1">{formData.title}</p>
              </div>
            )}
            {formData.phone && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</p>
                <p className="text-sm text-foreground mt-1">{formData.phone}</p>
              </div>
            )}
            {formData.bio && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bio</p>
                <p className="text-sm text-foreground mt-1">{formData.bio}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Account */}
      {!editing && (
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
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
           <div className="bg-card rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Confirm Account Deletion</h3>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete your account? This cannot be undone.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-3">
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