CREATE TABLE "web_approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"rank_id" uuid NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"decided_by_employee_id" uuid,
	"decided_by_user_id" uuid,
	"comment" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "web_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"summary" text NOT NULL,
	"changes" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rank_id" uuid NOT NULL,
	"hire_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "web_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'PUBLIC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "web_leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"year" integer,
	"days" numeric(5, 1) NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "web_leave_adjustments_year_ck" CHECK (("web_leave_adjustments"."bucket" = 'ANNUAL' and "web_leave_adjustments"."year" is not null) or ("web_leave_adjustments"."bucket" = 'MONTHLY'))
);
--> statement-breakpoint
CREATE TABLE "web_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text DEFAULT 'NEW' NOT NULL,
	"target_request_id" uuid,
	"leave_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"deducts" boolean NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"status_note" text,
	"decided_at" timestamp with time zone,
	"submitted_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "web_leave_requests_range_ck" CHECK ("web_leave_requests"."end_date" >= "web_leave_requests"."start_date")
);
--> statement-breakpoint
CREATE TABLE "web_ranks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_tenure_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_year" integer NOT NULL,
	"to_year" integer NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "web_tenure_rules_range_ck" CHECK ("web_tenure_rules"."from_year" >= 1 and "web_tenure_rules"."to_year" >= "web_tenure_rules"."from_year")
);
--> statement-breakpoint
CREATE TABLE "web_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_sub" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'MEMBER' NOT NULL,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "web_approval_steps" ADD CONSTRAINT "web_approval_steps_request_id_web_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."web_leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_approval_steps" ADD CONSTRAINT "web_approval_steps_rank_id_web_ranks_id_fk" FOREIGN KEY ("rank_id") REFERENCES "public"."web_ranks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_approval_steps" ADD CONSTRAINT "web_approval_steps_decided_by_employee_id_web_employees_id_fk" FOREIGN KEY ("decided_by_employee_id") REFERENCES "public"."web_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_approval_steps" ADD CONSTRAINT "web_approval_steps_decided_by_user_id_web_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."web_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_employees" ADD CONSTRAINT "web_employees_rank_id_web_ranks_id_fk" FOREIGN KEY ("rank_id") REFERENCES "public"."web_ranks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_leave_adjustments" ADD CONSTRAINT "web_leave_adjustments_employee_id_web_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."web_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_leave_adjustments" ADD CONSTRAINT "web_leave_adjustments_created_by_user_id_web_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."web_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_leave_requests" ADD CONSTRAINT "web_leave_requests_employee_id_web_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."web_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_leave_requests" ADD CONSTRAINT "web_leave_requests_target_request_id_web_leave_requests_id_fk" FOREIGN KEY ("target_request_id") REFERENCES "public"."web_leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_leave_requests" ADD CONSTRAINT "web_leave_requests_submitted_by_user_id_web_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."web_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_users" ADD CONSTRAINT "web_users_employee_id_web_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."web_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_approval_steps_request_step_uq" ON "web_approval_steps" USING btree ("request_id","step_no");--> statement-breakpoint
CREATE INDEX "web_approval_steps_pending_idx" ON "web_approval_steps" USING btree ("rank_id") WHERE "web_approval_steps"."is_deleted" = false and "web_approval_steps"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "web_audit_logs_created_idx" ON "web_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "web_audit_logs_entity_idx" ON "web_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "web_employees_alive_idx" ON "web_employees" USING btree ("rank_id") WHERE "web_employees"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "web_holidays_day_uq" ON "web_holidays" USING btree ("day") WHERE "web_holidays"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "web_leave_adjustments_employee_idx" ON "web_leave_adjustments" USING btree ("employee_id") WHERE "web_leave_adjustments"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "web_leave_requests_employee_idx" ON "web_leave_requests" USING btree ("employee_id","start_date") WHERE "web_leave_requests"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "web_leave_requests_period_idx" ON "web_leave_requests" USING btree ("start_date","end_date") WHERE "web_leave_requests"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "web_leave_requests_target_idx" ON "web_leave_requests" USING btree ("target_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_ranks_name_uq" ON "web_ranks" USING btree ("name") WHERE "web_ranks"."is_deleted" = false;--> statement-breakpoint
CREATE INDEX "web_ranks_alive_idx" ON "web_ranks" USING btree ("sort_order") WHERE "web_ranks"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_token_hash_uq" ON "web_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "web_sessions_user_idx" ON "web_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "web_sessions_expires_idx" ON "web_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "web_tenure_rules_alive_idx" ON "web_tenure_rules" USING btree ("from_year") WHERE "web_tenure_rules"."is_deleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "web_users_auth_sub_uq" ON "web_users" USING btree ("auth_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "web_users_employee_uq" ON "web_users" USING btree ("employee_id") WHERE "web_users"."is_deleted" = false and "web_users"."employee_id" is not null;--> statement-breakpoint
CREATE INDEX "web_users_alive_idx" ON "web_users" USING btree ("role") WHERE "web_users"."is_deleted" = false;