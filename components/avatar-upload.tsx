"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/primitives";
import { updateAvatar } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { Camera, Trash2 } from "lucide-react";

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function AvatarUpload({
  name,
  image,
  lang,
}: {
  name: string;
  image: string | null;
  lang?: Lang;
}) {
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = getT(lang ?? "cs");

  const save = (img: string | null) =>
    start(async () => {
      const r = await updateAvatar(img);
      if (r.ok) router.refresh();
      else toast.error(t.serverErr(r.error));
    });

  return (
    <div className="relative group w-fit">
      <Avatar name={name} image={image} className="size-16 text-xl" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            save(await compressAvatar(f));
          } catch {
            toast.error(t.imageBad);
          }
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        className="absolute -bottom-1 -right-1 size-7 rounded-full bg-surface border border-line text-mute hover:text-ink flex items-center justify-center cursor-pointer shadow-sm transition-colors"
        title={t.changeAvatar}
      >
        <Camera className="size-3.5" />
      </button>
      {image && (
        <button
          onClick={() => save(null)}
          disabled={pending}
          className="absolute -top-1 -left-1 size-6 rounded-full bg-surface border border-line text-mute hover:text-no flex items-center justify-center cursor-pointer shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          title={t.removeAvatar}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
