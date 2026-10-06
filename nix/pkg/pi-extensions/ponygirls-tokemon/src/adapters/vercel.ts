/**
 * Vercel AI Gateway credit balance, ported from tokemon.
 *
 * Schema pinned against a live response (2026-10-01) and the documented REST
 * API (vercel.com/docs/ai-gateway, "Check credit balance"):
 *
 *     GET /v1/credits
 *         {balance: "<USD>", total_used: "<USD>"}        # decimal strings
 *
 * `balance` is the team's remaining credit and `total_used` its lifetime
 * spend; there is no limit or reset, so spend is shown against their sum.
 */

import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot } from "../quota.ts";
import { optionalNumber, requireObject, topLevelKeys } from "../values.ts";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

export class VercelGatewayQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const body = requireObject(await getJson(http, CREDITS_URL, bearer(credential.secret)), "vercel credits");
    const balance = optionalNumber(body["balance"]);
    const totalUsed = optionalNumber(body["total_used"]);
    if (balance === null || totalUsed === null) throw new QuotaFetchError(`vercel credits: no balance/total_used (keys: ${topLevelKeys(body)})`);
    return { plan: null, identity: null, windows: [quotaWindow("credits", totalUsed, totalUsed + balance, "USD", null)], note: null };
  }
}
