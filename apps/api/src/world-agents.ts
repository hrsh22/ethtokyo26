import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from "jose";

const issuer = "https://sandbox.auth.world.org";
const acr = "https://world.org/oidc/acr/orb-v3";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 12_000 });
export function worldAgentsConfig() {
  const clientId=process.env.WORLD_AGENTS_CLIENT_ID, keyPath=process.env.WORLD_AGENTS_PRIVATE_KEY_PATH;
  const redirectUri=process.env.WORLD_AGENTS_REDIRECT_URI;
  if (!clientId || !keyPath || !redirectUri || process.env.WORLD_AGENTS_ISSUER!==issuer
    || process.env.WORLD_AGENTS_TOKEN_ENDPOINT_AUTH_METHOD!=="private_key_jwt") throw new Error("World ID for Agents is not configured.");
  return {clientId,keyPath,redirectUri,issuer,kid:process.env.WORLD_AGENTS_KEY_ID};
}
export function worldAgentsConfigured() { try { worldAgentsConfig(); return true; } catch { return false; } }
export function worldAuthorizationUrl(state:string, nonce:string, challenge:string) {
  const c=worldAgentsConfig(), url=new URL(`${issuer}/api/v1/authorize`);
  url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:"code",scope:"openid",
    state,nonce,code_challenge:challenge,code_challenge_method:"S256",max_age:"0",prompt:"login",acr_values:acr}).toString();
  return url.toString();
}
export function validateWorldClaims(claims:JWTPayload, nonce:string, startedAt:Date, now=Date.now()) {
  const auth=claims.auth_time;
  if (!claims.sub || claims.nonce!==nonce || claims.acr!==acr || !Array.isArray(claims.amr) || !claims.amr.includes("pop")
    || typeof auth!=="number" || !Number.isInteger(auth) || auth<Math.floor(startedAt.getTime()/1000)-2
    || auth>Math.floor(now/1000)+30 || now-startedAt.getTime()>8*60_000) {
    throw new Error("World verification was not fresh or did not match this request.");
  }
  return {issuer,subject:claims.sub};
}
export async function exchangeWorldCode(code:string, verifier:string, nonce:string, startedAt:Date) {
  const c=worldAgentsConfig(), endpoint=`${issuer}/api/v1/token`;
  const key=await importPKCS8(await readFile(c.keyPath,"utf8"),"RS256");
  const assertion=await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:c.kid}).setIssuer(c.clientId)
    .setSubject(c.clientId).setAudience(endpoint).setIssuedAt().setExpirationTime("60s").setJti(randomUUID()).sign(key);
  const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:c.redirectUri,code_verifier:verifier,
      client_id:c.clientId,client_assertion_type:"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",client_assertion:assertion}),
    signal:AbortSignal.timeout(15_000),redirect:"error"});
  if (!response.ok) throw new Error("World authentication could not be completed. Start a fresh verification.");
  const body=await response.json() as {id_token?:string};
  if (!body.id_token) throw new Error("World did not return a verified identity.");
  const verified=await jwtVerify(body.id_token,jwks,{issuer,audience:c.clientId,algorithms:["RS256"],clockTolerance:2,
    requiredClaims:["sub","exp","iat","nonce","auth_time","acr","amr"]});
  return validateWorldClaims(verified.payload,nonce,startedAt);
}
