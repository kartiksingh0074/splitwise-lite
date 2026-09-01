import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

async function registerUser(email: string, name = "Test User") {
  const res = await request(app).post("/api/v1/auth/register").send({
    email,
    name,
    password: "correct-horse-battery",
  });
  return res.body as { user: { id: string; email: string }; accessToken: string };
}

function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

describe("Groups", () => {
  it("non-member gets 404 on group detail", async () => {
    const owner = await registerUser("owner1@example.com");
    const stranger = await registerUser("stranger1@example.com");

    const createRes = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(owner.accessToken))
      .send({ name: "Trip", baseCurrency: "usd", memberEmails: [] });
    const groupId = createRes.body.group.id;

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(stranger.accessToken));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("member cannot rename group, owner can", async () => {
    const owner = await registerUser("owner2@example.com");
    const member = await registerUser("member2@example.com");

    const createRes = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(owner.accessToken))
      .send({ name: "Trip", baseCurrency: "USD", memberEmails: ["member2@example.com"] });
    const groupId = createRes.body.group.id;

    const memberRename = await request(app)
      .patch(`/api/v1/groups/${groupId}`)
      .set(authHeader(member.accessToken))
      .send({ name: "Renamed" });
    expect(memberRename.status).toBe(403);
    expect(memberRename.body.error.code).toBe("FORBIDDEN");

    const ownerRename = await request(app)
      .patch(`/api/v1/groups/${groupId}`)
      .set(authHeader(owner.accessToken))
      .send({ name: "Renamed" });
    expect(ownerRename.status).toBe(200);
    expect(ownerRename.body.name).toBe("Renamed");
  });

  it("creates immediate members for existing emails and pending invites for unregistered ones", async () => {
    const owner = await registerUser("owner3@example.com");
    await registerUser("existing3@example.com");

    const res = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(owner.accessToken))
      .send({
        name: "Trip",
        baseCurrency: "USD",
        memberEmails: ["existing3@example.com", "unregistered3@example.com"],
      });

    expect(res.status).toBe(201);
    expect(res.body.pendingInvites).toHaveLength(1);
    expect(res.body.pendingInvites[0].email).toBe("unregistered3@example.com");

    const groupId = res.body.group.id;
    const detail = await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(owner.accessToken));

    expect(detail.status).toBe(200);
    const emails = detail.body.members.map((m: { email: string }) => m.email);
    expect(emails).toContain("existing3@example.com");
  });

  it("invite accept flow: works once, rejects reuse", async () => {
    const owner = await registerUser("owner4@example.com");
    const joiner = await registerUser("joiner4@example.com");

    const createRes = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(owner.accessToken))
      .send({ name: "Trip", baseCurrency: "USD", memberEmails: [] });
    const groupId = createRes.body.group.id;

    const inviteRes = await request(app)
      .post(`/api/v1/groups/${groupId}/invites`)
      .set(authHeader(owner.accessToken));
    expect(inviteRes.status).toBe(201);
    const code = inviteRes.body.code as string;

    const acceptRes = await request(app)
      .post(`/api/v1/invites/${code}/accept`)
      .set(authHeader(joiner.accessToken));
    expect(acceptRes.status).toBe(200);

    const reacceptRes = await request(app)
      .post(`/api/v1/invites/${code}/accept`)
      .set(authHeader(owner.accessToken));
    expect(reacceptRes.status).toBe(404);
    expect(reacceptRes.body.error.code).toBe("INVITE_INVALID");
  });

  it("owner removes a member; cannot remove the sole remaining owner", async () => {
    const owner = await registerUser("owner5@example.com");
    const member = await registerUser("member5@example.com");

    const createRes = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(owner.accessToken))
      .send({ name: "Trip", baseCurrency: "USD", memberEmails: ["member5@example.com"] });
    const groupId = createRes.body.group.id;

    const removeRes = await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${member.user.id}`)
      .set(authHeader(owner.accessToken));
    expect(removeRes.status).toBe(204);

    const removeSelfRes = await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${owner.user.id}`)
      .set(authHeader(owner.accessToken));
    expect(removeSelfRes.status).toBe(409);
    expect(removeSelfRes.body.error.code).toBe("LAST_OWNER");
  });
});
