import { useState, useEffect } from "react";
import { Badge } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

export function PendingInvitations() {
  const { addToast } = useToast();
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInvitations();
  }, []);

  const loadInvitations = async () => {
    try {
      const { data } = await api.get("/user/me/invitations");
      setInvitations(data.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const accept = async (token) => {
    try {
      await api.post(`/invitations/${token}/accept`);
      setInvitations((prev) => prev.filter((i) => i.token !== token));
      addToast({ message: "Invitation accepted!", type: "success" });
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Failed.", type: "error" });
    }
  };

  const decline = async (token) => {
    try {
      await api.post(`/invitations/${token}/decline`);
      setInvitations((prev) => prev.filter((i) => i.token !== token));
    } catch {
      addToast({ message: "Failed to decline.", type: "error" });
    }
  };

  if (loading || invitations.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-700">Pending Invitations</h3>
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium">{inv.accountName}</p>
            <Badge color="blue">{inv.role}</Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => accept(inv.token)}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={() => decline(inv.token)}>Decline</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
