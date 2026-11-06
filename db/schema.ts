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
// coach_email links an opening to the coach's staff record (name, active), so families can book it (issue #70).
export const coachOpenings=sqliteTable("coach_openings",{id:text("id").primaryKey(),userId:text("user_id").notNull(),date:text("date").notNull(),start:text("start").notNull(),end:text("end").notNull(),coachEmail:text("coach_email")});
export const securityEvents=sqliteTable("security_events",{id:text("id").primaryKey(),actor:text("actor").notNull(),action:text("action").notNull(),target:text("target").notNull(),createdAt:text("created_at").notNull()});
export const recoverySnapshots=sqliteTable("recovery_snapshots",{id:text("id").primaryKey(),payload:text("payload").notNull(),createdAt:text("created_at").notNull()});
export const restoreGuard=sqliteTable("restore_guard",{id:text("id").primaryKey(),valid:integer("valid").notNull()},t=>[check('valid_restore',sql`${t.valid} = 1`)]);

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
// Waivers (issue #69). Each published text is a new, never-edited version; families sign per wrestler per version.
export const waiverVersions=sqliteTable("waiver_versions",{
 id:text("id").primaryKey(),title:text("title").notNull(),body:text("body").notNull(),sha256:text("sha256").notNull(),
 publishedAt:text("published_at").notNull(),publishedBy:text("published_by").notNull(),retiredAt:text("retired_at")
},t=>[index("waiver_versions_published").on(t.publishedAt)]);
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
// Waitlists for full camps and events (issue #73). An offer holds a seat for one family until it expires.
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
export const announcements=sqliteTable("announcements",{
 id:text("id").primaryKey(),subject:text("subject").notNull(),body:text("body").notNull(),audience:text("audience").notNull(),audienceLabel:text("audience_label").notNull(),
 sentBy:text("sent_by").notNull(),sentAt:text("sent_at").notNull(),recipients:integer("recipients").notNull()
},t=>[index("announcements_sent").on(t.sentAt)]);
export const announcementRecipients=sqliteTable("announcement_recipients",{
 announcementId:text("announcement_id").notNull(),userId:text("user_id").notNull(),email:text("email").notNull(),readAt:text("read_at"),emailStatus:text("email_status").notNull()
},t=>[primaryKey({columns:[t.announcementId,t.userId]}),index("announcement_recipients_user").on(t.userId)]);
export const familyMessages=sqliteTable("family_messages",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),senderRole:text("sender_role").notNull(),body:text("body").notNull(),createdAt:text("created_at").notNull(),
 readAt:text("read_at"),emailStatus:text("email_status").notNull()
},t=>[index("family_messages_thread").on(t.userId,t.createdAt),check("family_message_sender",sql`${t.senderRole} IN ('owner','family')`)]);
// Owner exceptions to the card and waiver booking blocks (issue #89). Each has a reason and an end date.
export const bookingExceptions=sqliteTable("booking_exceptions",{
 id:text("id").primaryKey(),userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),rule:text("rule").notNull(),
 startsOn:text("starts_on").notNull(),endsOn:text("ends_on").notNull(),reason:text("reason").notNull(),
 createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull(),revokedAt:text("revoked_at"),revokedBy:text("revoked_by")
},t=>[index("booking_exceptions_wrestler").on(t.userId,t.wrestlerId,t.rule),check("booking_exception_rule",sql`${t.rule} IN ('usaw','waiver')`)]);
// Automatic notices to families and coaches (issue #105). dedupe_key makes each event notify once.
export const notifications=sqliteTable("notifications",{
 id:text("id").primaryKey(),userId:text("user_id"),email:text("email").notNull(),kind:text("kind").notNull(),subject:text("subject").notNull(),body:text("body").notNull(),
 dedupeKey:text("dedupe_key").notNull(),createdAt:text("created_at").notNull(),readAt:text("read_at"),emailStatus:text("email_status").notNull()
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
