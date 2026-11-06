import {sql} from "drizzle-orm";
import { sqliteTable, text, integer, check, uniqueIndex, index } from "drizzle-orm/sqlite-core";
export const academyState = sqliteTable("academy_state", {
 id: text("id").primaryKey(), payload: text("payload").notNull(),
 revision: integer("revision").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: text("updated_at").notNull()
});

export const familyAccounts=sqliteTable("family_accounts",{
 userId:text("user_id").primaryKey(),email:text("email").notNull(),payload:text("payload").notNull(),revision:integer("revision").notNull(),updatedAt:text("updated_at").notNull()
});
export const authAttempts=sqliteTable("auth_attempts",{id:text("id").primaryKey(),count:integer("count").notNull(),bucket:integer("bucket").notNull()});

export const staffAccess=sqliteTable("staff_access",{email:text("email").primaryKey(),name:text("name").notNull(),programs:text("programs").notNull(),active:integer("active").notNull(),updatedAt:text("updated_at").notNull()});
export const coachOpenings=sqliteTable("coach_openings",{id:text("id").primaryKey(),userId:text("user_id").notNull(),date:text("date").notNull(),start:text("start").notNull(),end:text("end").notNull()});
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

export const wrestlerMembershipCards=sqliteTable("wrestler_membership_cards",{
 userId:text("user_id").notNull(),wrestlerId:text("wrestler_id").notNull(),cardNumber:text("card_number").notNull(),
 expiresOn:text("expires_on").notNull(),photoKey:text("photo_key").notNull(),photoType:text("photo_type").notNull(),
 revision:integer("revision").notNull(),verifiedAt:text("verified_at"),verifiedBy:text("verified_by")
},t=>[uniqueIndex("wrestler_card_family_wrestler").on(t.userId,t.wrestlerId)]);

export const practicePlans=sqliteTable("practice_plans",{
 id:text("id").primaryKey(),program:text("program").notNull(),date:text("date").notNull(),payload:text("payload").notNull(),published:integer("published").notNull(),revision:integer("revision").notNull(),updatedBy:text("updated_by").notNull(),updatedAt:text("updated_at").notNull()
},t=>[uniqueIndex("practice_plan_program_date").on(t.program,t.date),check("practice_plan_published",sql`${t.published} IN (0,1)`)]);

export const practicePlanSubmissions=sqliteTable("practice_plan_submissions",{
 id:text("id").primaryKey(),program:text("program").notNull(),date:text("date").notNull(),
 coachId:text("coach_id").notNull(),coachName:text("coach_name").notNull(),
 payload:text("payload").notNull(),status:text("status").notNull(),
 revision:integer("revision").notNull(),updatedAt:text("updated_at").notNull(),publishToken:text("publish_token")
},t=>[
 uniqueIndex("practice_plan_submission_coach_session").on(t.coachId,t.program,t.date),
 index("practice_plan_submission_review_date").on(t.status,t.date),
 check("practice_plan_submission_status",sql`${t.status} IN ('draft','submitted','published')`)
]);

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


export const coachProfiles=sqliteTable('coach_profiles',{
 email:text('email').primaryKey(),userId:text('user_id').notNull(),payload:text('payload').notNull(),
 revision:integer('revision').notNull(),photoKey:text('photo_key'),photoType:text('photo_type'),updatedAt:text('updated_at').notNull()
});


export const documentTemplates=sqliteTable('document_templates',{
 id:text('id').primaryKey(),title:text('title').notNull(),kind:text('kind').notNull(),body:text('body').notNull(),revision:integer('revision').notNull(),archived:integer('archived').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[check('document_kind',sql`${t.kind} IN ('waiver','contract')`),check('document_archived',sql`${t.archived} IN (0,1)`)]);
export const documentVersions=sqliteTable('document_versions',{
 id:text('id').primaryKey(),templateId:text('template_id').notNull(),version:integer('version').notNull(),sourceRevision:integer('source_revision').notNull(),title:text('title').notNull(),kind:text('kind').notNull(),body:text('body').notNull(),bodyHash:text('body_hash').notNull(),publishedAt:text('published_at').notNull(),publishedBy:text('published_by').notNull()
},t=>[uniqueIndex('document_template_version').on(t.templateId,t.version),uniqueIndex('document_published_revision').on(t.templateId,t.sourceRevision)]);
export const documentAssignments=sqliteTable('document_assignments',{
 id:text('id').primaryKey(),versionId:text('version_id').notNull(),userId:text('user_id').notNull(),familyEmail:text('family_email').notNull(),parentName:text('parent_name').notNull(),wrestlerId:text('wrestler_id').notNull(),wrestlerName:text('wrestler_name').notNull(),wrestlerGrade:text('wrestler_grade').notNull(),status:text('status').notNull().default('pending'),assignedAt:text('assigned_at').notNull(),assignedBy:text('assigned_by').notNull(),signer:text('signer'),signerRole:text('signer_role'),signedAt:text('signed_at'),signatureRecord:text('signature_record')
},t=>[uniqueIndex('document_family_wrestler_version').on(t.versionId,t.userId,t.wrestlerId).where(sql`${t.status} IN ('pending','signed')`),index('document_family_status').on(t.userId,t.status),index('document_assignment_time').on(t.assignedAt,t.id),check('document_assignment_status',sql`${t.status} IN ('pending','signed','void')`)]);

export const financialEntries=sqliteTable('financial_entries',{
 id:text('id').primaryKey(),date:text('date').notNull(),kind:text('kind').notNull(),category:text('category').notNull(),description:text('description').notNull(),cents:integer('cents').notNull(),revision:integer('revision').notNull().default(1),voidedAt:text('voided_at'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),updatedBy:text('updated_by').notNull()
},t=>[check('financial_entry_kind',sql`${t.kind} IN ('income','expense')`),check('financial_entry_cents',sql`${t.cents} BETWEEN 1 AND 100000000`),index('financial_entry_date').on(t.date,t.id)]);

export const coachLessonRates=sqliteTable('coach_lesson_rates',{
 email:text('email').primaryKey(),rateCents:integer('rate_cents')
},t=>[check('coach_lesson_rate_cents',sql`${t.rateCents} BETWEEN 1 AND 100000`)]);

export const coachTimeEntries=sqliteTable('coach_time_entries',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),coachName:text('coach_name').notNull(),coachEmail:text('coach_email').notNull(),
 program:text('program').notNull(),duty:text('duty').notNull(),workDate:text('work_date').notNull(),
 startedAt:text('started_at').notNull(),endedAt:text('ended_at'),closedAt:text('closed_at'),
 approvedSeconds:integer('approved_seconds'),approvedDuty:text('approved_duty'),approvedRateCents:integer('approved_rate_cents'),rateCents:integer('rate_cents').notNull(),
 draftSeconds:integer('draft_seconds'),draftDuty:text('draft_duty'),draftNote:text('draft_note'),submittedAt:text('submitted_at'),
 reviewNote:text('review_note'),approvedAt:text('approved_at'),approvedBy:text('approved_by'),
 voidedAt:text('voided_at'),practiceContext:text('practice_context'),
 lessonFormat:text('lesson_format'),lessonGrossCents:integer('lesson_gross_cents'),approvedLessonGrossCents:integer('approved_lesson_gross_cents'),
 revision:integer('revision').notNull().default(1)
},t=>[
 uniqueIndex('coach_one_open_shift').on(t.userId).where(sql`${t.closedAt} IS NULL`),
 index('coach_time_period').on(t.workDate,t.id),
 index('coach_time_by_user').on(t.userId,t.workDate,t.id),
 check('coach_time_duty',sql`${t.duty} IN ('head','assistant','private_lesson')`),
 check('coach_time_approved_duty',sql`${t.approvedDuty} IN ('head','assistant','private_lesson')`),
 check('coach_time_approved_seconds',sql`${t.approvedSeconds} BETWEEN 1 AND 86400`)
]);

export const coachTimeOff=sqliteTable('coach_time_off',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),coachName:text('coach_name').notNull(),
 category:text('category').notNull(),startDate:text('start_date').notNull(),endDate:text('end_date').notNull(),
 note:text('note').notNull().default(''),status:text('status').notNull().default('pending'),
 submittedAt:text('submitted_at').notNull(),reviewedAt:text('reviewed_at'),reviewedBy:text('reviewed_by'),
 revision:integer('revision').notNull().default(1)
},t=>[
 check('coach_time_off_category',sql`${t.category} IN ('sick','personal','vacation','other')`),
 check('coach_time_off_status',sql`${t.status} IN ('pending','approved','declined','withdrawn','cancelled')`),
 check('coach_time_off_range',sql`${t.startDate} <= ${t.endDate}`),
 index('coach_time_off_person').on(t.userId,t.submittedAt,t.id),
 index('coach_time_off_queue').on(t.status,t.submittedAt,t.id)
]);

export const programEnrollments=sqliteTable('program_enrollments',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),wrestlerId:text('wrestler_id').notNull(),program:text('program').notNull(),
 kind:text('kind').notNull(),startsOn:text('starts_on').notNull(),endsOn:text('ends_on').notNull(),
 practiceStart:text('practice_start'),practiceEnd:text('practice_end'),
 createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull(),voidedAt:text('voided_at')
},t=>[
 index('enrollment_roster').on(t.program,t.startsOn,t.endsOn),
 index('enrollment_family').on(t.userId,t.wrestlerId),
 check('enrollment_kind',sql`(${t.kind}='membership' AND ${t.practiceStart} IS NULL AND ${t.practiceEnd} IS NULL) OR
  (${t.kind}='walkin' AND ${t.startsOn}=${t.endsOn} AND ${t.practiceStart} IS NOT NULL AND ${t.practiceEnd} IS NOT NULL)`)
]);

export const wrestlerPasses=sqliteTable('wrestler_passes',{
 token:text('token').primaryKey(),userId:text('user_id').notNull(),wrestlerId:text('wrestler_id').notNull()
},t=>[uniqueIndex('wrestler_pass_owner').on(t.userId,t.wrestlerId)]);

export const attendanceCheckins=sqliteTable('attendance_checkins',{
 practiceId:text('practice_id').notNull(),date:text('date').notNull(),program:text('program').notNull(),
 practiceStart:text('practice_start').notNull(),practiceEnd:text('practice_end').notNull(),
 userId:text('user_id').notNull(),wrestlerId:text('wrestler_id').notNull(),wrestlerName:text('wrestler_name').notNull(),
 checkedAt:text('checked_at').notNull(),method:text('method').notNull(),checkedBy:text('checked_by').notNull()
},t=>[
 uniqueIndex('attendance_practice_wrestler').on(t.practiceId,t.userId,t.wrestlerId),
 index('attendance_day').on(t.date)
]);
