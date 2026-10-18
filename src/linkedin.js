import { cfg } from "./config.js";

// PUBLISH_MODE=dry-run (default) never contacts LinkedIn. Set PUBLISH_MODE=live plus
// LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN to publish for real.
export async function publish({ text, sourceUrl, runId }) {
  const c = cfg();
  if (c.publishMode !== "live") return { url: `dry-run://linkedin/run-${runId}`, dryRun: true };
  if (!c.liToken || !c.liAuthor) throw new Error("LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN are required for live publishing");
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { authorization: `Bearer ${c.liToken}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
    body: JSON.stringify({
      author: c.liAuthor,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "ARTICLE",
        media: [{ status: "READY", originalUrl: sourceUrl }],
      } },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const id = res.headers.get("x-restli-id") || (await res.json().catch(() => ({}))).id;
  return { url: `https://www.linkedin.com/feed/update/${id}`, dryRun: false };
}
