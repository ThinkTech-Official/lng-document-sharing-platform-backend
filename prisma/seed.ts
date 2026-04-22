import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const name = process.env.SUPERADMIN_NAME ?? 'Superadmin';
  const plainPassword = process.env.SUPERADMIN_PASSWORD;

  if (!email) throw new Error('SUPERADMIN_EMAIL is required');
  if (!plainPassword) throw new Error('SUPERADMIN_PASSWORD is required');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Superadmin already exists — skipping');
    return;
  }

  const password = await bcrypt.hash(plainPassword, 10);

  const superadmin = await prisma.user.create({
    data: {
      email,
      name,
      password,
      role: Role.SUPERADMIN,
      is_active: true,
      force_password_reset: false,
    },
  });

  console.log(`Superadmin created: ${superadmin.email} (id: ${superadmin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
