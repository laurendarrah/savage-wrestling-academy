import { accountReply,verifiedAccount } from '../../../lib/account-auth';
import { accountRole,roleDestination } from '../../../lib/access-control';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
// What the Account security page shows: who is signed in and where their home is. Sign-in is a confirmed email and a
// password, nothing more (issues #306, #347), so there is nothing here to set up or verify.
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await verifiedAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign in with your email and password first.'},401,auth.headers);
 const {role}=await accountRole(auth.user);
 return accountReply({email:auth.user.email,role,destination:roleDestination(role)},200,auth.headers);
}
// A page left open from before Nov 14 may still post here. It changes nothing and gets one plain sentence.
export const GONE='This page has changed. Reload it to continue: your email and password are all you need to sign in.';
export const POST = withApi(POST_); async function POST_(){return accountReply({error:GONE},410)}
