import { prisma } from '../db/prisma.js';
import { getRuntimeSettings, saveRuntimeSettings, startRuntimeConfigStore } from './service.js';

const [userIdArg, ...args] = process.argv.slice(2);
const userId = userIdArg?.trim();
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const introspectUrl = option('--introspect-url')?.trim();
const userIdField = option('--user-id-field')?.trim();

if (!userId || userId.length > 255 || (args.includes('--introspect-url') && !introspectUrl) || (args.includes('--user-id-field') && !userIdField)) {
  console.error('Usage: npm run admin:bootstrap -w apps/api -- <verified-user-id> [--introspect-url <url>] [--user-id-field <field>]');
  process.exitCode = 1;
} else {
  try {
    await startRuntimeConfigStore();
    const settings = getRuntimeSettings();
    if (introspectUrl || userIdField) {
      if (introspectUrl) settings.authIntrospectUrl = introspectUrl;
      if (userIdField) settings.authMapping.userId = userIdField;
      await saveRuntimeSettings(settings);
    }
    if (!settings.authIntrospectUrl) {
      throw new Error('Auth introspection is not configured. Supply --introspect-url to initialize it.');
    }

    const admin = await prisma.runtimeAdmin.upsert({
      where: { userId },
      create: { userId, createdByUserId: null },
      update: {},
      select: { userId: true },
    });
    console.log(`Runtime administrator ready: ${admin.userId}`);
  } catch (error) {
    console.error('Unable to bootstrap runtime administrator', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
