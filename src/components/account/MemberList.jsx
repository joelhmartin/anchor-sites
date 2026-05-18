import { useState, useEffect } from "react";
import { useAccount } from "../../hooks/useAccount.js";
import { usePermission } from "../../hooks/usePermission.js";
import { Avatar } from "../ui/Avatar.jsx";
import { Badge } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

const roleBadgeColors = {
  owner: "blue",
  admin: "green",
  manager: "yellow",
  member: "gray",
  viewer: "gray",
};

export function MemberList() {
  const { activeAccount } = useAccount();
  const { can } = usePermission();
  const { addToast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeAccount) return;
    loadMembers();
  }, [activeAccount?.accountId]);

  const loadMembers = async () => {
    try {
      const { data } = await api.get(`/accounts/${activeAccount.accountId}/members`);
      setMembers(data.data);
    } catch {
      addToast({ message: "Failed to load members.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async (memberId) => {
    try {
      await api.delete(`/accounts/${activeAccount.accountId}/members/${memberId}`);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      addToast({ message: "Member removed.", type: "success" });
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Failed to remove member.",
        type: "error",
      });
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Avatar src={member.userAvatar} name={member.userName} size="sm" />
            <div>
              <p className="text-sm font-medium text-gray-900">{member.userName}</p>
              <p className="text-xs text-gray-500">{member.userEmail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={roleBadgeColors[member.role]}>{member.role}</Badge>
            {can("users:remove") && member.role !== "owner" && (
              <Button size="sm" variant="ghost" onClick={() => removeMember(member.id)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
