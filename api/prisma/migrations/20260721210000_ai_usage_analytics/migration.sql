CREATE TABLE `AiUsageEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `actorEmail` VARCHAR(191) NULL,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `thinkingTokens` INTEGER NOT NULL DEFAULT 0,
    `cachedTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `estimatedCostMicros` INTEGER NOT NULL DEFAULT 0,
    `pricingVersion` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUCCESS',
    `latencyMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiUsageEvent_createdAt_idx`(`createdAt`),
    INDEX `AiUsageEvent_feature_createdAt_idx`(`feature`, `createdAt`),
    INDEX `AiUsageEvent_model_createdAt_idx`(`model`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
