import {sql} from "drizzle-orm";
import { sqliteTable, text, integer, check, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
export const academyState = sqliteTable("academy_state", {
 id: text("id").primaryKey(), payload: text("payload").notNull(),
 revision: integer("revision").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: text("updated_at").notNull()
});

export const familyAccounts=sqliteTable("family_accounts",{
 userId:text("user_id").primaryKey(),email:text("email").notNull(),payload:text("payload").notNull(),revision:integer("revision").notNull(),updatedAt:text("updated_at").notNull()
});
export const authAttempts=sqliteTable("auth_attempts",{id:text("id").primaryKey(),count:integer("count").notNull(),bucket:integer("bucket").notNull()});

export const staffAccess=sqliteTable("staff_access",{email:text("email").primaryKey(),name:text("name").notNull(),programs:text("programs").notNull(),active:integer("active").notNull(),updatedAt:text("updated_at").notNull()});
// Coach invitations (issue #190). The owner invites a coach by name, email and programs. The link carries a random
// 256-bit token; only its SHA-256 hash is stored. An invite expires, works once, and only for the invited email.
// Accepting it grants staff_access. Not backed up: restoring a file must never grant access.
export const coachInvites=sqliteTable("coach_invites",{
 id:text("id").primaryKey(),tokenHash:text("token_hash").notNull(),email:text("email").notNull(),name:text("name").notNull(),programs:text("programs").notNull(),
 createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull(),expiresAt:text("expires_at").notNull(),usedAt:text("used_at"),usedBy:text("used_by"),revokedAt:text("revoked_at")
},t=>[uniqueIndex("coach_invites_token").on(t.tokenHash),index("coach_invites_email").on(t.email)]);
// Coach profiles (issue #190): what a coach says about themselves, keyed by their staff_access email. Families see the
// display name, bio and specialties; the phone is for the academy only. photo_key stays empty until photos (#192).
export const coachProfiles=sqliteTable("coach_profiles",{
 email:text("email").primaryKey(),displayName:text("display_name").notNull(),bio:text("bio").notNull(),specialties:text("specialties").notNull(),phone:text("phone").notNull(),
 photoKey:text("photo_key"),updatedAt:text("updated_at").notNull(),updatedBy:text("updated_by").notNull()
});
// coach_email links an opening to the coach's staff record (name, active), so families can book it (issue #70).
// Partner and small-group lessons (issue #177): format null is an ordinary open time (one-on-one, or a family can ask
// for a private group on it). capacity is the number of wrestlers. closed=1 marks a family-requested private group:
// never listed, joined only with invite_code (random, 192 bits). organizer_wrestlers holds the organising family's own
// wrestlers, whose spots are kept for them until they are paid for.
export const coachOpenings=sqliteTable("coach_openings",{id:text("id").primaryKey(),userId:text("user_id").notNull(),date:text("date").notNull(),start:text("start").notNull(),end:text("end").notNull(),coachEmail:text("coach_email"),
 format:text("format"),capacity:integer("capacity"),closed:integer("closed").notNull().default(0),inviteCode:text("invite_code"),organizerId:text("organizer_id"),organizerWrestlers:text("organizer_wrestlers")
},t=>[uniqueIndex("coach_openings_invite").on(t.inviteCode)]);
export const securityEvents=sqliteTable("security_events",{id:text("id").primaryKey(),actor:text("actor").notNull(),action:text("action").notNull(),target:text("target").notNull(),createdAt:text("created_at").notNull()});
export const recoverySnapshots=sqliteTable("recovery_snapshots",{id:text("id").primaryKey(),payload:text("payload").notNull(),createdAt:text("created_at").notNull()});
export const restoreGuard=sqliteTable("restore_guard",{id:text("id").primaryKey(),valid:integer("valid").notNull()},t=>[check('valid_restore',sql`${t.valid} = 1`)]);
// A large backup is uploaded for restore in parts before one batch applies it (issue #221). Each row is one checked part
// (a JSON list of rows for one section, under D1's 2 MB value limit). Rows are removed when the restore finishes or
// fails, when the owner starts another restore, and by the daily job after a day.
export const restoreStaging=sqliteTable("restore_staging",{id:text("id").primaryKey(),upload:text("upload").notNull(),userId:text("user_id").notNull(),seq:integer("seq").notNull(),
 section:text("section").notNull(),grouped:integer("grouped").notNull().default(0),rowCount:integer("row_count").notNull(),bytes:integer("bytes").notNull(),payload:text("payload").notNull(),createdAt:text("created_at").notNull()
},t=>[index("restore_staging_upload").on(t.upload,t.seq),index("restore_staging_created").on(t.createdAt)]);

export const programApprovals=sqliteTable("program_approvals",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),program:text("program").notNull(),
 wrestlerName:text("wrestler_name").notNull(),grade:text("grade").notNull(),status:text("status").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull(),decidedBy:text("decided_by")
},t=>[uniqueIndex("approval_family_wrestler_program").on(t.userId,t.wrestlerId,t.program),check("approval_status",sql`${t.status} IN ('pending','approved','declined')`)]);

export const approvalMessages=sqliteTable("approval_messages",{
 id:text("id").primaryKey(),approvalId:text("approval_id").notNull(),senderId:text("sender_id").notNull(),senderRole:text("sender_role").notNull(),body:text("body").notNull(),createdAt:text("created_at").notNull()
},t=>[index("approval_messages_thread_order").on(t.approvalId,t.createdAt,t.id),check("approval_sender_role",sql`${t.senderRole} IN ('owner','parent')`)]);

export const practicePlans=sqliteTable("practice_plans",{
 id:text("id").primaryKey(),program:text("program").notNull(),date:text("date").notNull(),payload:text("payload").notNull(),published:integer("published").notNull(),revision:integer("revision").notNull(),updatedBy:text("updated_by").notNull(),updatedAt:text("updated_at").notNull()
},t=>[uniqueIndex("practice_plan_program_date").on(t.program,t.date),check("practice_plan_published",sql`${t.published} IN (0,1)`)]);

export const practiceCurricula=sqliteTable("practice_curricula",{
 id:text("id").primaryKey(),curriculumId:text("curriculum_id"),lessonOrder:integer("lesson_order").notNull().default(0),name:text("name").notNull(),nameKey:text("name_key").notNull(),payload:text("payload").notNull(),revision:integer("revision").notNull(),updatedBy:text("updated_by").notNull(),updatedAt:text("updated_at").notNull()
},t=>[uniqueIndex("practice_curriculum_lesson_name").on(t.curriculumId,t.nameKey)]);

export const practiceCurriculumGroups=sqliteTable("practice_curriculum_groups",{
 id:text("id").primaryKey(),program:text("program").notNull(),name:text("name").notNull(),nameKey:text("name_key").notNull(),revision:integer("revision").notNull(),updatedBy:text("updated_by").notNull(),updatedAt:text("updated_at").notNull()
},t=>[uniqueIndex("curriculum_program_name").on(t.program,t.nameKey)]);

// Owner-managed integration credentials are encrypted before storage; never included in family exports.
export const integrationSecrets=sqliteTable('integration_secrets',{
 id:text('id').primaryKey(),encrypted:text('encrypted').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()
});

export const scholarshipAwards=sqliteTable('scholarship_awards',{
 id:text('id').primaryKey(),tokenHash:text('token_hash').notNull(),recipientEmail:text('recipient_email').notNull(),
 wrestlerName:text('wrestler_name').notNull(),program:text('program').notNull(),referenceCents:integer('reference_cents').notNull(),
 termsText:text('terms_text').notNull(),termsReady:integer('terms_ready').notNull().default(0),revision:integer('revision').notNull().default(1),
 status:text('status').notNull().default('offered'),userId:text('user_id'),wrestlerId:text('wrestler_id'),signer:text('signer'),
 acceptedAt:text('accepted_at'),signatureRecord:text('signature_record'),endedAt:text('ended_at'),expiresAt:text('expires_at').notNull(),createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull()
},t=>[uniqueIndex('scholarship_invite_hash').on(t.tokenHash),
 uniqueIndex('scholarship_active_wrestler').on(t.userId,t.wrestlerId).where(sql`${t.status} = 'active'`),
 check('scholarship_status',sql`${t.status} IN ('offered','active','revoked','ended')`),
 check('scholarship_ready',sql`${t.termsReady} IN (0,1)`)]);

// Launch 1 payments (issues #18, #19). An order is created before Stripe Checkout and becomes
// paid only through a verified Stripe webhook. Prices are computed on the server.
export const orders=sqliteTable("orders",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),email:text("email").notNull(),
 wrestlerId:text("wrestler_id").notNull(),wrestlerName:text("wrestler_name").notNull(),
 kind:text("kind").notNull(),program:text("program"),itemId:text("item_id").notNull(),itemLabel:text("item_label").notNull(),
 dates:text("dates").notNull(),baseCents:integer("base_cents").notNull(),discountCents:integer("discount_cents").notNull(),
 amountCents:integer("amount_cents").notNull(),currency:text("currency").notNull(),pricing:text("pricing").notNull(),
 termsAccepted:text("terms_accepted").notNull(),status:text("status").notNull(),dedupeKey:text("dedupe_key").notNull(),
 stripeSessionId:text("stripe_session_id"),stripePaymentIntent:text("stripe_payment_intent"),livemode:integer("livemode").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull(),paidAt:text("paid_at"),
 termStart:text("term_start"),termEnd:text("term_end"),
 // "stripe" for online checkout, "offline" for cash, check or other payments the owner records (issue #62).
 source:text("source").notNull().default("stripe")
},t=>[
 index("orders_user").on(t.userId),
 index("orders_wrestler_status").on(t.userId,t.wrestlerId,t.status),
 uniqueIndex("orders_stripe_session").on(t.stripeSessionId),
 uniqueIndex("orders_open_dedupe").on(t.dedupeKey).where(sql`${t.status} IN ('pending','paid')`),
 check("orders_kind",sql`${t.kind} IN ('walkin','annual','monthly','event','live','lesson')`),
 check("orders_status",sql`${t.status} IN ('pending','paid','expired','canceled','refunded')`),
 check("orders_amounts",sql`${t.amountCents} >= 0 AND ${t.baseCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.amountCents} = ${t.baseCents} - ${t.discountCents}`),
 check("orders_livemode",sql`${t.livemode} IN (0,1)`)
]);

// Every Stripe event id is recorded once, so a repeated delivery cannot be applied twice.
export const stripeEvents=sqliteTable("stripe_events",{
 id:text("id").primaryKey(),type:text("type").notNull(),orderId:text("order_id"),outcome:text("outcome").notNull(),receivedAt:text("received_at").notNull()
});

// Real attendance (issue #22). One row per wrestler per session; the unique index makes check-in idempotent.
// session_key: practice:<program>:<date>:<start>, live:<id>:<date> or event:<id>:<date>.
export const attendance=sqliteTable("attendance",{
 id:text("id").primaryKey(),sessionKey:text("session_key").notNull(),sessionDate:text("session_date").notNull(),
 userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),wrestlerName:text("wrestler_name").notNull(),
 source:text("source").notNull(),checkedInAt:text("checked_in_at").notNull(),checkedInBy:text("checked_in_by").notNull()
},t=>[uniqueIndex("attendance_once").on(t.sessionKey,t.userId,t.wrestlerId),index("attendance_date").on(t.sessionDate)]);

// Monthly memberships (issue #20). One row per monthly order. Stripe charges monthly and the subscription is
// set to cancel exactly 12 months after it starts, so there is never a 13th charge. orders.term_end tracks
// the paid-through date, so every existing access check (roster, member pricing, family page) follows payments.
export const subscriptions=sqliteTable("subscriptions",{
 orderId:text("order_id").primaryKey(),stripeSubscriptionId:text("stripe_subscription_id").notNull(),
 status:text("status").notNull(),paymentsMade:integer("payments_made").notNull(),paymentsTotal:integer("payments_total").notNull(),
 termStart:text("term_start").notNull(),termEnd:text("term_end").notNull(),paidThrough:text("paid_through").notNull(),
 cancelAt:text("cancel_at").notNull(),updatedAt:text("updated_at").notNull()
},t=>[uniqueIndex("subscriptions_stripe").on(t.stripeSubscriptionId),check("subscriptions_status",sql`${t.status} IN ('active','past_due','canceled','completed')`),check("subscriptions_payments",sql`${t.paymentsMade} >= 0 AND ${t.paymentsMade} <= ${t.paymentsTotal}`)]);

// Owner review of a wrestler's USA Wrestling card (issue #68). Applies only while the number and expiration on
// the family profile still match what was reviewed, so a family edit clears an earlier review.
export const usawReviews=sqliteTable("usaw_reviews",{
 userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),number:text("number").notNull(),expires:text("expires").notNull(),
 status:text("status").notNull(),note:text("note").notNull(),reviewedBy:text("reviewed_by").notNull(),reviewedAt:text("reviewed_at").notNull()
},t=>[primaryKey({columns:[t.userId,t.wrestlerId]}),check("usaw_review_status",sql`${t.status} IN ('valid','invalid')`)]);
// The latest check of a wrestler's card on USA Wrestling's public verify page (issue #202). Only the status, the name
// and state USA Wrestling shows, and the date are kept, never their page. The same rows are the 24-hour cache per
// card number and season. A verification it makes is a usaw_reviews row with reviewed_by 'usaw-lookup'.
export const usawLookups=sqliteTable("usaw_lookups",{
 userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),number:text("number").notNull(),expires:text("expires").notNull(),
 season:text("season").notNull(),status:text("status").notNull(),outcome:text("outcome").notNull(),cardName:text("card_name"),cardState:text("card_state"),
 checkedAt:text("checked_at").notNull()
},t=>[primaryKey({columns:[t.userId,t.wrestlerId]}),index("usaw_lookups_card").on(t.number,t.season,t.checkedAt),
 check("usaw_lookup_status",sql`${t.status} IN ('active','inactive','not_found','unavailable')`),
 check("usaw_lookup_outcome",sql`${t.outcome} IN ('verified','inactive','not_found','mismatch','season','unavailable')`)]);
// Waivers (issue #69). Each published text is a new, never-edited version; families sign per wrestler per version.
// Signed documents (issue #195): the same two tables hold every document people sign on the site. `kind` is 'waiver',
// 'parent_consent' or 'coach_contract' (checked in lib/documents.ts); rows from before #195 are all waivers. A coach
// contract signature has an empty wrestler_id and wrestler_name: the coach signs for themselves.
export const waiverVersions=sqliteTable("waiver_versions",{
 id:text("id").primaryKey(),title:text("title").notNull(),body:text("body").notNull(),sha256:text("sha256").notNull(),
 publishedAt:text("published_at").notNull(),publishedBy:text("published_by").notNull(),retiredAt:text("retired_at"),
 kind:text("kind").notNull().default("waiver")
},t=>[index("waiver_versions_published").on(t.publishedAt),index("waiver_versions_kind").on(t.kind,t.publishedAt)]);
export const waiverSignatures=sqliteTable("waiver_signatures",{
 id:text("id").primaryKey(),versionId:text("version_id").notNull(),userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),
 wrestlerName:text("wrestler_name").notNull(),signer:text("signer").notNull(),email:text("email").notNull(),
 signatureRecord:text("signature_record").notNull(),signedAt:text("signed_at").notNull()
},t=>[uniqueIndex("waiver_signature_per_child").on(t.versionId,t.userId,t.wrestlerId,t.wrestlerName),index("waiver_signatures_family").on(t.userId,t.wrestlerId)]);
// Owner settings that are not part of the published academy state, as one JSON document per key (issue #70: lesson
// prices and coach pay splits).
export const academySettings=sqliteTable("academy_settings",{
 id:text("id").primaryKey(),payload:text("payload").notNull(),updatedAt:text("updated_at").notNull(),updatedBy:text("updated_by").notNull()
});
// QR entry passes (issue #71). One active pass per wrestler; replacing one revokes the old code at once.
export const wrestlerPasses=sqliteTable("wrestler_passes",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),token:text("token").notNull(),
 createdAt:text("created_at").notNull(),revokedAt:text("revoked_at"),revokedBy:text("revoked_by")
},t=>[uniqueIndex("wrestler_pass_token").on(t.token),uniqueIndex("wrestler_pass_active").on(t.userId,t.wrestlerId).where(sql`${t.revokedAt} IS NULL`)]);
// Waitlists for full camps and events (issue #73). No longer used: there are no waitlists (decision Q10 in #197, issue
// #210). The table and its rows are kept: backups, the family data export and the security log still read them.
export const waitlistEntries=sqliteTable("waitlist_entries",{
 id:text("id").primaryKey(),eventId:text("event_id").notNull(),option:text("option").notNull(),dates:text("dates").notNull(),
 userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),wrestlerName:text("wrestler_name").notNull(),email:text("email").notNull(),
 status:text("status").notNull(),createdAt:text("created_at").notNull(),offeredAt:text("offered_at"),offerExpiresAt:text("offer_expires_at"),
 offerHours:integer("offer_hours"),autoNext:integer("auto_next").notNull().default(0),offeredBy:text("offered_by"),closedAt:text("closed_at")
},t=>[index("waitlist_event").on(t.eventId,t.status,t.createdAt),uniqueIndex("waitlist_once").on(t.eventId,t.userId,t.wrestlerId).where(sql`${t.status} IN ('waiting','offered')`),
 check("waitlist_status",sql`${t.status} IN ('waiting','offered','accepted','expired','withdrawn','removed')`)]);
// Program transfers (issue #74). orders.program holds the latest program; each row records the program before a
// transfer took effect, so rosters for earlier dates still show the program the wrestler was in then.
export const membershipTransfers=sqliteTable("membership_transfers",{
 id:text("id").primaryKey(),orderId:text("order_id").notNull(),fromProgram:text("from_program").notNull(),toProgram:text("to_program").notNull(),
 effectiveDate:text("effective_date").notNull(),reason:text("reason").notNull(),transferredBy:text("transferred_by").notNull(),createdAt:text("created_at").notNull()
},t=>[index("transfers_order").on(t.orderId,t.effectiveDate)]);
// Announcements and family messages (issue #72). Recipients are fixed when an announcement is sent.
// email_error (issue #35) is why an email did not send, as a short code from lib/email.ts; not backed up.
export const announcements=sqliteTable("announcements",{
 id:text("id").primaryKey(),subject:text("subject").notNull(),body:text("body").notNull(),audience:text("audience").notNull(),audienceLabel:text("audience_label").notNull(),
 sentBy:text("sent_by").notNull(),sentAt:text("sent_at").notNull(),recipients:integer("recipients").notNull()
},t=>[index("announcements_sent").on(t.sentAt)]);
export const announcementRecipients=sqliteTable("announcement_recipients",{
 announcementId:text("announcement_id").notNull(),userId:text("user_id").notNull(),email:text("email").notNull(),readAt:text("read_at"),emailStatus:text("email_status").notNull(),
 emailError:text("email_error")
},t=>[primaryKey({columns:[t.announcementId,t.userId]}),index("announcement_recipients_user").on(t.userId)]);
export const familyMessages=sqliteTable("family_messages",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),senderRole:text("sender_role").notNull(),body:text("body").notNull(),createdAt:text("created_at").notNull(),
 readAt:text("read_at"),emailStatus:text("email_status").notNull(),emailError:text("email_error")
},t=>[index("family_messages_thread").on(t.userId,t.createdAt),check("family_message_sender",sql`${t.senderRole} IN ('owner','family')`)]);
// Owner exceptions to the card, waiver and Parent Consent Form booking blocks (issues #89, #195). Each has a reason and
// an end date.
export const bookingExceptions=sqliteTable("booking_exceptions",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),rule:text("rule").notNull(),
 startsOn:text("starts_on").notNull(),endsOn:text("ends_on").notNull(),reason:text("reason").notNull(),
 createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull(),revokedAt:text("revoked_at"),revokedBy:text("revoked_by")
},t=>[index("booking_exceptions_wrestler").on(t.userId,t.wrestlerId,t.rule),check("booking_exception_rule",sql`${t.rule} IN ('usaw','waiver','parent_consent')`)]);
// Automatic notices to families and coaches (issue #105). dedupe_key makes each event notify once.
export const notifications=sqliteTable("notifications",{
 id:text("id").primaryKey(),userId:text("user_id"),email:text("email").notNull(),kind:text("kind").notNull(),subject:text("subject").notNull(),body:text("body").notNull(),
 dedupeKey:text("dedupe_key").notNull(),createdAt:text("created_at").notNull(),readAt:text("read_at"),emailStatus:text("email_status").notNull(),emailError:text("email_error")
},t=>[uniqueIndex("notifications_once").on(t.dedupeKey),index("notifications_user").on(t.userId,t.createdAt)]);
// Server errors for the owner's site health page (issue #107). Transient: not backed up, last 500 kept.
export const errorLog=sqliteTable("error_log",{
 id:text("id").primaryKey(),at:text("at").notNull(),method:text("method").notNull(),path:text("path").notNull(),status:integer("status").notNull(),message:text("message").notNull()
},t=>[index("error_log_at").on(t.at)]);
// Family data requests (issue #113): closure requests the owner handles and records.
export const dataRequests=sqliteTable("data_requests",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),email:text("email").notNull(),kind:text("kind").notNull(),note:text("note").notNull(),status:text("status").notNull(),
 createdAt:text("created_at").notNull(),resolvedAt:text("resolved_at"),resolvedBy:text("resolved_by"),resolution:text("resolution")
},t=>[index("data_requests_status").on(t.status,t.createdAt),check("data_request_kind",sql`${t.kind} IN ('close')`),check("data_request_status",sql`${t.status} IN ('open','handled')`)]);
// The academy's books (issue #194). Only what the owner types in lives here: expenses and other income. Card and
// offline payments are read from orders when the books are shown (lib/financials.ts), so they are never stored twice.
// Amounts are whole cents. A deleted entry keeps its row (deleted_at) so the change history stays complete.
export const financialEntries=sqliteTable("financial_entries",{
 id:text("id").primaryKey(),kind:text("kind").notNull(),entryDate:text("entry_date").notNull(),amountCents:integer("amount_cents").notNull(),
 category:text("category").notNull(),note:text("note").notNull(),receipt:text("receipt").notNull(),revision:integer("revision").notNull(),
 createdAt:text("created_at").notNull(),createdBy:text("created_by").notNull(),updatedAt:text("updated_at").notNull(),updatedBy:text("updated_by").notNull(),
 deletedAt:text("deleted_at"),deletedBy:text("deleted_by")
},t=>[index("financial_entries_date").on(t.entryDate),check("financial_entry_kind",sql`${t.kind} IN ('expense','income')`),
 check("financial_entry_amount",sql`${t.amountCents} BETWEEN 1 AND 100000000`)]);
// Coach timesheets (issue #193). One row per shift, keyed to the coach's staff email. A shift is tied to the practice
// (session_key, title and times copied when it starts) when there is one. Paid time is the part of the shift inside the
// scheduled practice (#197 Q4), unless the owner sets it (owner_minutes, with a reason). fixed_in and fixed_out are the
// coach's own corrections; clock_in and clock_out keep the original punches. Approval copies the minutes, role, rate and
// amount, so a later rate change never alters an approved month. Voided shifts are kept, never deleted. history is a
// JSON list of every correction, void and approval with who, when and why.
export const coachTimeEntries=sqliteTable("coach_time_entries",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),coachEmail:text("coach_email").notNull(),coachName:text("coach_name").notNull(),workDate:text("work_date").notNull(),
 sessionKey:text("session_key"),sessionTitle:text("session_title"),sessionStart:text("session_start"),sessionEnd:text("session_end"),
 duty:text("duty").notNull(),source:text("source").notNull(),clockIn:text("clock_in").notNull(),clockOut:text("clock_out"),fixedIn:text("fixed_in"),fixedOut:text("fixed_out"),coachNote:text("coach_note"),
 submittedAt:text("submitted_at"),ownerMinutes:integer("owner_minutes"),ownerDuty:text("owner_duty"),ownerNote:text("owner_note"),
 approvedAt:text("approved_at"),approvedBy:text("approved_by"),approvedMinutes:integer("approved_minutes"),approvedDuty:text("approved_duty"),approvedRateCents:integer("approved_rate_cents"),approvedCents:integer("approved_cents"),
 voidedAt:text("voided_at"),voidedBy:text("voided_by"),voidReason:text("void_reason"),history:text("history").notNull().default('[]'),revision:integer("revision").notNull().default(1),createdAt:text("created_at").notNull()
},t=>[uniqueIndex("coach_time_one_open").on(t.coachEmail).where(sql`${t.clockOut} IS NULL AND ${t.voidedAt} IS NULL`),index("coach_time_month").on(t.workDate,t.coachEmail),
 check("coach_time_duty",sql`${t.duty} IN ('head','assistant') AND (${t.ownerDuty} IS NULL OR ${t.ownerDuty} IN ('head','assistant')) AND (${t.approvedDuty} IS NULL OR ${t.approvedDuty} IN ('head','assistant'))`),
 check("coach_time_source",sql`${t.source} IN ('clock','hand')`),
 check("coach_time_minutes",sql`(${t.ownerMinutes} IS NULL OR ${t.ownerMinutes} BETWEEN 0 AND 1440) AND (${t.approvedMinutes} IS NULL OR ${t.approvedMinutes} BETWEEN 0 AND 1440) AND (${t.approvedCents} IS NULL OR ${t.approvedCents} >= 0)`)]);
// Coach time off (issue #193). A coach asks for dates with a reason; the owner approves or declines. On approval
// (#197 Q7) the coaches in the same programs are told, the request shows on the coach's time history, and the coach's
// practices and lessons in those dates are flagged for cover on the owner's pages. programs is the coach's programs
// when it was approved. Nothing is cancelled automatically.
export const coachTimeOff=sqliteTable("coach_time_off",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),coachEmail:text("coach_email").notNull(),coachName:text("coach_name").notNull(),
 startDate:text("start_date").notNull(),endDate:text("end_date").notNull(),reason:text("reason").notNull(),status:text("status").notNull(),programs:text("programs").notNull().default('[]'),
 requestedAt:text("requested_at").notNull(),decidedAt:text("decided_at"),decidedBy:text("decided_by"),decisionNote:text("decision_note"),revision:integer("revision").notNull().default(1)
},t=>[index("coach_time_off_coach").on(t.coachEmail,t.startDate),index("coach_time_off_status").on(t.status,t.startDate),
 check("coach_time_off_status",sql`${t.status} IN ('pending','approved','declined','withdrawn')`),check("coach_time_off_range",sql`${t.startDate} <= ${t.endDate}`)]);
// Coaches removed for good (issue #212; #197 Q18). Their records are kept for 3 years from removed_on (the academy's
// date), then lib/coach-retention.ts deletes or anonymizes them in the daily job. email and name are cleared once that
// is done; email_hash (see emailHash) stays, so records that a restored backup brings back are cleaned again. Rows that
// are kept name the coach "former-coach-<id>", never by email. Backed up, so a restored file keeps the 3-year clock.
export const removedCoaches=sqliteTable("removed_coaches",{
 id:text("id").primaryKey(),emailHash:text("email_hash").notNull(),email:text("email"),name:text("name"),removedOn:text("removed_on").notNull(),cleanedAt:text("cleaned_at")
},t=>[uniqueIndex("removed_coaches_email").on(t.emailHash)]);

// Card refunds (issue #42). One row per Stripe charge.refunded event, holding Stripe's cumulative amount_refunded for that
// payment at the time of the event (never an increment), so replays and late or out-of-order events converge. Each
// refund in the books is the change from the payment's previous row, dated when Stripe sent the event. id is the
// Stripe event id; payment_intent identifies the card payment (a one-time order, or one monthly payment).
export const paymentRefunds=sqliteTable("payment_refunds",{
 id:text("id").primaryKey(),orderId:text("order_id").notNull(),paymentIntent:text("payment_intent").notNull(),chargeId:text("charge_id"),
 amountCents:integer("amount_cents").notNull(),refundedCents:integer("refunded_cents").notNull(),refundedAt:text("refunded_at").notNull(),
 livemode:integer("livemode").notNull(),receivedAt:text("received_at").notNull()
},t=>[index("payment_refunds_intent").on(t.paymentIntent,t.refundedAt),index("payment_refunds_order").on(t.orderId),
 check("payment_refund_amounts",sql`${t.refundedCents} >= 0 AND ${t.refundedCents} <= ${t.amountCents}`),check("payment_refund_livemode",sql`${t.livemode} IN (0,1)`)]);

// Stripe card processing fees (issue #42). One row per successful card payment, read from its charge's balance
// transaction by lib/stripe-fees.ts (the daily job, or the owner's button on /financials), never by the webhook, so a
// fee lookup can never hold up marking an order paid. A payment without a row is one whose fee is not known yet.
export const stripeFees=sqliteTable("stripe_fees",{
 paymentIntent:text("payment_intent").primaryKey(),orderId:text("order_id").notNull(),chargeId:text("charge_id").notNull(),
 balanceTransaction:text("balance_transaction").notNull(),amountCents:integer("amount_cents").notNull(),feeCents:integer("fee_cents").notNull(),
 netCents:integer("net_cents").notNull(),chargedAt:text("charged_at").notNull(),livemode:integer("livemode").notNull(),recordedAt:text("recorded_at").notNull()
},t=>[index("stripe_fees_order").on(t.orderId),index("stripe_fees_charged").on(t.chargedAt),
 check("stripe_fee_amounts",sql`${t.feeCents} >= 0 AND ${t.amountCents} >= 0`),check("stripe_fee_livemode",sql`${t.livemode} IN (0,1)`)]);
