CREATE TABLE "runtime_admins" (
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "runtime_admins_pkey" PRIMARY KEY ("user_id")
);
