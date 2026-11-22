  let result: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  try {
    const serialized = JSON.stringify(resultValue);
    result = serialized === undefined || serialized === 'null'
      ? Prisma.JsonNull
      : JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    result = String(resultValue);
  }