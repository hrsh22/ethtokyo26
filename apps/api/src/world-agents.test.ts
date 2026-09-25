import {afterEach,describe,expect,it,vi} from "vitest";
import {validateWorldClaims,worldAuthorizationUrl} from "./world-agents";
const started=new Date("2026-09-25T12:00:00Z"),now=started.getTime()+10_000;
const claims={sub:"person-a",nonce:"attempt-a",acr:"https://world.org/oidc/acr/orb-v3",amr:["pop"],auth_time:started.getTime()/1000};
afterEach(()=>vi.unstubAllEnvs());
describe("World Agents freshness",()=>{
  it("accepts fresh proof of possession",()=>expect(validateWorldClaims(claims,"attempt-a",started,now).subject).toBe("person-a"));
  it.each([{nonce:"other"},{sub:""},{acr:"weak"},{amr:["pwd"]},{auth_time:claims.auth_time-20},{auth_time:claims.auth_time+120},{auth_time:undefined}])("rejects mismatched or stale claims %j",patch=>{
    expect(()=>validateWorldClaims({...claims,...patch},"attempt-a",started,now)).toThrow();
  });
  it("does not confuse a new token with a fresh authentication",()=>expect(()=>validateWorldClaims({...claims,iat:now/1000,auth_time:claims.auth_time-600},"attempt-a",started,now)).toThrow());
  it("requests fresh World authentication with PKCE",()=>{
    for(const [key,value] of Object.entries({WORLD_AGENTS_CLIENT_ID:"client",WORLD_AGENTS_PRIVATE_KEY_PATH:"/test",WORLD_AGENTS_ISSUER:"https://sandbox.auth.world.org",WORLD_AGENTS_REDIRECT_URI:"https://accord-api.hrsh.dev/v1/approvals/world/callback",WORLD_AGENTS_TOKEN_ENDPOINT_AUTH_METHOD:"private_key_jwt"}))vi.stubEnv(key,value);
    const u=new URL(worldAuthorizationUrl("state","nonce","challenge"));
    expect(u.origin).toBe("https://sandbox.auth.world.org");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({state:"state",nonce:"nonce",max_age:"0",prompt:"login",code_challenge_method:"S256",code_challenge:"challenge",scope:"openid"});
  });
});
