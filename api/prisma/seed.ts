import { CoinReason, PrismaClient, ResidentGuideContentType, ResourceType } from "@prisma/client";

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

  const seedGuides = [
    {
      slug: "laundry",
      titleVi: "Giặt sấy (Laundry)",
      titleEn: "Laundry",
      sortOrder: 10,
      contentType: ResidentGuideContentType.STEPS,
      videoUrl: null,
      stepsJson: [
        {
          bodyVi: "Mở tab Dịch vụ → Giặt sấy, chọn máy và khung giờ trống.",
          bodyEn: "Open Service → Laundry, pick a machine and an open time slot."
        },
        {
          bodyVi: "Đặt chỗ bằng Cozoro Coins; đến đúng giờ và bấm bắt đầu trên máy theo hướng dẫn tại chỗ.",
          bodyEn: "Book with Cozoro Coins; arrive on time and start the machine as posted on-site."
        }
      ],
      updatedBy: "seed"
    },
    {
      slug: "cleaning_schedule",
      titleVi: "Lịch vệ sinh (Cleaning)",
      titleEn: "Cleaning schedule",
      sortOrder: 20,
      contentType: ResidentGuideContentType.STEPS,
      videoUrl: null,
      stepsJson: [
        {
          bodyVi: "Mở Lịch / Cleaning schedule để xem nhiệm vụ được giao hoặc slot trống.",
          bodyEn: "Open Schedule / Cleaning schedule to see assigned tasks or open slots."
        },
        {
          bodyVi: "Bạn có thể tự đăng ký slot trống (self-assign) theo quy định chi nhánh; hoàn thành đúng ngày để nhận thưởng coin.",
          bodyEn: "You can self-assign open slots per branch rules; complete on time for coin rewards."
        }
      ],
      updatedBy: "seed"
    }
  ];

  for (const g of seedGuides) {
    const existing = await prisma.residentGuideSection.findUnique({ where: { slug: g.slug } });
    if (!existing) {
      await prisma.residentGuideSection.create({ data: g });
    }
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
