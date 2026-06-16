# Gas Refill Request Approval System - Vercel & GitHub Deployment Guide

This project contains the complete code for a Gas Refill Request Web Application built with HTML, CSS, JavaScript, and Node.js Serverless API endpoints, hosted on **Vercel** with a **Supabase PostgreSQL Database** backend.

---

## 1. Create a Supabase Project & Table
1. Sign in to your [Supabase Console](https://supabase.com/).
2. Create a **New project** and fill in your project details.
3. Once provisioned, click on **SQL Editor** in the left sidebar.
4. Click **New query** and paste the following SQL schema to construct the requests table:

```sql
-- Create the Gas Refill Requests table
CREATE TABLE IF NOT EXISTS gas_refill_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  employee_name TEXT NOT NULL,
  employee_mobile VARCHAR(20) NOT NULL,
  branch TEXT NOT NULL,
  cylinder_type VARCHAR(100) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  expected_amount NUMERIC(12, 2) NOT NULL CHECK (expected_amount > 0),
  remarks TEXT,
  status VARCHAR(20) DEFAULT 'Pending' NOT NULL,
  approved_amount NUMERIC(12, 2),
  admin_remarks TEXT,
  approved_by VARCHAR(100),
  approval_date_time TIMESTAMPTZ,
  whatsapp_status VARCHAR(50) DEFAULT 'Pending Approval' NOT NULL
);

-- Enable indexes for optimized queries
CREATE INDEX IF NOT EXISTS idx_gas_requests_status ON gas_refill_requests(status);
CREATE INDEX IF NOT EXISTS idx_gas_requests_request_id ON gas_refill_requests(request_id);
```
5. Click **Run** to execute the query.
6. **Configure Row-Level Security (RLS)**:
   By default, new tables in Supabase have RLS enabled, which blocks insertions/reads unless policies are defined or the Service Role key is used. Run **one** of the following in the SQL Editor:
   * **Option A (Recommended & Easiest)**: Disable RLS for this table.
     ```sql
     ALTER TABLE gas_refill_requests DISABLE ROW LEVEL SECURITY;
     ```
   * **Option B (Create specific policies)**: Keep RLS active and allow public access for anonymous inserts, selects, and updates.
     ```sql
     CREATE POLICY "Allow public insert" ON gas_refill_requests FOR INSERT TO anon WITH CHECK (true);
     CREATE POLICY "Allow public select" ON gas_refill_requests FOR SELECT TO anon USING (true);
     CREATE POLICY "Allow public update" ON gas_refill_requests FOR UPDATE TO anon USING (true);
     ```

---

## 2. Push Code to GitHub

Open your terminal or command prompt (PowerShell) and navigate to the project root directory:

```bash
# Initialize local repository
git init

# Add all files to staging area
git add .

# Commit files
git commit -m "Initial commit of Gas Refill Approval system for Vercel"

# Rename default branch to main
git branch -M main

# Add your GitHub remote repository link (Create a new blank repo on GitHub first!)
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git

# Push code to GitHub
git push -u origin main
```

---

## 3. Deploy to Vercel

1. Log in to your [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** and select **Project**.
3. Select your imported GitHub repository from the list and click **Import**.
4. Expand the **Environment Variables** section and add the following keys:

| Key | Description | Example |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Your Supabase project URL | `https://ykocydrgtugunfamibmq.supabase.co` |
| `SUPABASE_KEY` | Your Supabase API Key (If RLS is disabled/policies exist, use `anon`. Otherwise, use `service_role`) | `eyJhbGciOiJIUzI1NiIsInR5...` |
| `ADMIN_PASSWORD` | Password to lock the Admin Portal | `admin123` |
| `WHATSAPP_API_URL` | *(Optional)* WhatsApp Gateway webhook URL | `https://api.whatsapp.com/send...` |
| `WHATSAPP_API_TOKEN` | *(Optional)* WhatsApp Gateway Authorization Token | `Bearer token...` |

5. Click **Deploy**. Vercel will build and launch your application in seconds!

---

## 4. Web Application URLs

After deployment, your application will be accessible at:
* **Employee Request Form**: `https://YOUR_PROJECT_NAME.vercel.app/`
* **Admin Dashboard Portal**: `https://YOUR_PROJECT_NAME.vercel.app/admin`
