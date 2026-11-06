import Stripe from 'stripe';
import {env} from 'cloudflare:workers';
import {stripeMode, type StripeMode} from './checkout-config';
export const STRIPE_TEST_ACCOUNT='acct_1U8nF9PkPTNkVQBz';
export function validTestKey(value:unknown):value is string{return typeof value==='string'&&/^rk_test_[A-Za-z0-9_]{16,512}$/.test(value)}
// Local rehearsals only (issue #111): STRIPE_API_BASE sends TEST-mode calls to Stripe's stripe-mock server on this
// machine. It is ignored in live mode and for any host that is not loopback, so it can never redirect real traffic.
export function testApiOverride(mode:'test'|'live'='test'){const raw=(env as Cloudflare.Env&{STRIPE_API_BASE?:string}).STRIPE_API_BASE;if(mode!=='test'||!raw)return {};try{const u=new URL(raw);if(!['127.0.0.1','localhost'].includes(u.hostname))return {};return {host:u.hostname,port:u.port||(u.protocol==='https:'?'443':'80'),protocol:u.protocol.replace(':','') as 'http'|'https'}}catch{return {}}}
export function stripeTestClient(key:string){if(!validTestKey(key))throw Error('A restricted test key is required.');return new Stripe(key,{apiVersion:'2026-09-30.endive',httpClient:Stripe.createFetchHttpClient(),...testApiOverride('test'),maxNetworkRetries:1,timeout:15000})}
const aad=new TextEncoder().encode('savage:stripe-test:v1');
async function encryptionKey(){const raw=(env as Cloudflare.Env&{STRIPE_CONFIG_ENCRYPTION_KEY?:string}).STRIPE_CONFIG_ENCRYPTION_KEY;if(!raw||! /^[a-f0-9]{64}$/.test(raw))throw Error('Secure storage is not configured.');return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g)!,x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function sealStripeKey(secret:string){if(!validTestKey(secret))throw Error('A restricted test key is required.');const key=await encryptionKey(),iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(secret)));return JSON.stringify({v:1,iv:Array.from(iv),data:Array.from(encrypted)})}
export async function storedStripeKey(){const row=await env.DB!.prepare("SELECT encrypted FROM integration_secrets WHERE id='stripe-test'").first<{encrypted:string}>();if(!row)return null;const v=JSON.parse(row.encrypted),key=await encryptionKey();if(v.v!==1||!Array.isArray(v.iv)||v.iv.length!==12||!Array.isArray(v.data))throw Error('Invalid encrypted credential.');const secret=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(v.iv),additionalData:aad},key,new Uint8Array(v.data)));if(!validTestKey(secret))throw Error('Invalid stored test key.');return secret}
export async function testKeyConfigured(){const row=await env.DB!.prepare("SELECT updated_at FROM integration_secrets WHERE id='stripe-test'").first<{updated_at:string}>();return {configured:!!row,updatedAt:row?.updated_at??null}}

// Mode-aware key handling (issue #26). Test and live keys use separate storage rows and separate
// encryption labels, so a stored test key can never be decrypted or used as a live key.
export {stripeMode};
export type {StripeMode};
const KEY_PATTERN: Record<StripeMode, RegExp> = {test: /^rk_test_[A-Za-z0-9_]{16,512}$/, live: /^rk_live_[A-Za-z0-9_]{16,512}$/};
export function validKeyFor(mode: StripeMode, value: unknown): value is string { return typeof value === 'string' && KEY_PATTERN[mode].test(value); }
export function expectedStripeAccount(): string {
  const a = (env as Cloudflare.Env & {STRIPE_ACCOUNT_ID?: string}).STRIPE_ACCOUNT_ID;
  return typeof a === 'string' && /^acct_[A-Za-z0-9]{8,64}$/.test(a) ? a : STRIPE_TEST_ACCOUNT;
}
export function stripeClientFor(mode: StripeMode, key: string) {
  if (!validKeyFor(mode, key)) throw Error(`A restricted ${mode} key is required.`);
  return new Stripe(key, {apiVersion: '2026-09-30.endive', httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 15000, ...testApiOverride(mode)});
}
const labelFor = (mode: StripeMode) => new TextEncoder().encode(`savage:stripe-${mode}:v1`);
export async function sealStripeKeyFor(mode: StripeMode, secret: string) {
  if (!validKeyFor(mode, secret)) throw Error(`A restricted ${mode} key is required.`);
  const key = await encryptionKey(), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: labelFor(mode)}, key, new TextEncoder().encode(secret)));
  return JSON.stringify({v: 1, iv: Array.from(iv), data: Array.from(encrypted)});
}
export async function storedStripeKeyFor(mode: StripeMode) {
  const row = await env.DB!.prepare('SELECT encrypted FROM integration_secrets WHERE id=?').bind(`stripe-${mode}`).first<{encrypted: string}>();
  if (!row) return null;
  const v = JSON.parse(row.encrypted), key = await encryptionKey();
  if (v.v !== 1 || !Array.isArray(v.iv) || v.iv.length !== 12 || !Array.isArray(v.data)) throw Error('Invalid encrypted credential.');
  const secret = new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: new Uint8Array(v.iv), additionalData: labelFor(mode)}, key, new Uint8Array(v.data)));
  if (!validKeyFor(mode, secret)) throw Error('Invalid stored key.');
  return secret;
}
export async function keyConfiguredFor(mode: StripeMode) {
  const row = await env.DB!.prepare('SELECT updated_at FROM integration_secrets WHERE id=?').bind(`stripe-${mode}`).first<{updated_at: string}>();
  return {configured: !!row, updatedAt: row?.updated_at ?? null};
}
