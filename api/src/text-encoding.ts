const MOJIBAKE_PATTERN = /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/;

function scoreVietnamese(value: string) {
  const vietnameseMatches = value.match(
    /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi
  );
  const mojibakeMatches = value.match(MOJIBAKE_PATTERN);
  return (vietnameseMatches?.length ?? 0) - (mojibakeMatches?.length ?? 0);
}

export function repairMojibake(value: string) {
  if (!value || !MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8").normalize("NFC");
    return scoreVietnamese(repaired) >= scoreVietnamese(value) ? repaired : value;
  } catch {
    return value;
  }
}

export function repairUnknownText<T>(input: T): T {
  if (typeof input === "string") {
    return repairMojibake(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((value) => repairUnknownText(value)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        repairMojibake(key),
        repairUnknownText(value)
      ])
    ) as T;
  }

  return input;
}
