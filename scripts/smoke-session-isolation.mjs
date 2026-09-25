import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const jar = new Map();
const header = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
async function login(port) {
  const base = `http://localhost:${port}`;
  const account = privateKeyToAccount(generatePrivateKey());
  const post = (path, body) => fetch(base + '/api/v1/auth/' + path, {method:'POST', headers:{'Content-Type':'application/json', origin:base, cookie:header()},body:JSON.stringify(body)});
  const challenge = await (await post('challenge',{address:account.address})).json();
  const signature = await account.signMessage({message:challenge.message});
  const response = await post('verify',{id:challenge.id,address:account.address,signature,client:'browser'});
  assert.equal(response.status,200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const index = cookie.indexOf('=');
  const name = cookie.slice(0,index);
  jar.set(name,cookie.slice(index+1));
  return name;
}
const normalCookie = await login(3000);
assert.equal((await fetch('http://localhost:3000/api/v1/auth/session',{headers:{cookie:header()}})).status,200);
const testCookie = await login(3001);
const status = (await fetch('http://localhost:3000/api/v1/auth/session',{headers:{cookie:header()}})).status;
console.log({normalCookie,testCookie,normalSessionAfterTestLogin:status});
assert.equal(status,200,'Test login must not overwrite the normal app session');
assert.equal((await fetch('http://localhost:3001/api/v1/auth/session',{headers:{cookie:header()}})).status,200);
console.log('PASS: both sessions remain authenticated');
