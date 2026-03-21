import { CoinReason, PrismaClient, ResourceType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.branch.upsert({
    where: { id: "D2" },
    update: { name: "D2" },
    create: { id: "D2", name: "D2" }
  });

  await prisma.branch.upsert({
    where: { id: "D7" },
    update: { name: "D7" },
    create: { id: "D7", name: "D7" }
  });

  const resources = [
    { branchId: "D2", type: ResourceType.WASHER, label: "Washer 1" },
    { branchId: "D7", type: ResourceType.WASHER, label: "Washer 1" },
    { branchId: "D7", type: ResourceType.WASHER, label: "Washer 2" },
    { branchId: "D7", type: ResourceType.DRYER, label: "Dryer 1" }
  ];

  for (const resource of resources) {
    const existing = await prisma.resource.findFirst({
      where: {
        branchId: resource.branchId,
        label: resource.label,
        type: resource.type
      }
    });

    if (!existing) {
      await prisma.resource.create({ data: resource });
    }
  }

  const balance = await prisma.coinLedger.aggregate({
    _sum: { delta: true },
    where: { userId: "demo-user" }
  });

  if ((balance._sum.delta ?? 0) <= 0) {
    await prisma.coinLedger.create({
      data: {
        userId: "demo-user",
        delta: 100,
        reason: CoinReason.TOPUP,
        refType: "seed",
        refId: "demo-user-initial-topup"
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
