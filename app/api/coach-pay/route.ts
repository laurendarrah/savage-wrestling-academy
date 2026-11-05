// Owner coach pay report (issue #75), as JSON or CSV.
import {ownerIdentity, accountReply} from '../../../lib/account-auth';
import {coachPayReport, coachPayCsv} from '../../../lib/coach-pay';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const q = new URL(request.url).searchParams, report = await coachPayReport(q.get('from'), q.get('to'));
  if ('error' in report) return accountReply({error: report.error}, 400, auth.headers);
  if (q.get('format') === 'csv') {
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-coach-pay-${report.from}-to-${report.to}.csv"`);
    return new Response(coachPayCsv(report.coaches), {headers: auth.headers});
  }
  return accountReply(report, 200, auth.headers);
}
