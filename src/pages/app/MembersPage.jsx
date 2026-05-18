import { useState } from "react";
import { H1 } from "../../components/ui/Typography.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { MemberList } from "../../components/account/MemberList.jsx";
import { InviteMemberModal } from "../../components/account/InviteMemberModal.jsx";
import { usePermission } from "../../hooks/usePermission.js";

export function MembersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { can } = usePermission();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <H1>Members</H1>
        {can("users:invite") && (
          <Button onClick={() => setInviteOpen(true)}>Invite Member</Button>
        )}
      </div>
      <MemberList />
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
