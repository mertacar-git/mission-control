"""Caption actual application screenshots; requires FFmpeg and DejaVu Sans."""
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[2]
MEDIA=ROOT/'docs/media'
WORK=ROOT/'.runtime/video-v18'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SCENES=[
 ('experiments-v18.png','01 / SÜRÜMLÜ DENEYLER','Görev ve ayarlar sabitlenir; her tekrar ayrı koşu ve kayıt oluşturur.\nBaşarı, gerçek SITL telemetrisinde gözlenen koşullara bağlıdır.'),
 ('flight-comparison-v18.png','02 / AYNI GÖREVİN İKİ GERÇEK KOŞUSU','Tamamlanma, veri boşluğu, sınır ve rota sapması birlikte incelenir.\n4× simülasyon; süreler backend duvar saatidir. Otomatik kazanan seçilmez.'),
 ('serial-replay-v18.png','03 / WINDOWS SERİ ALICISI','Ham baytlar yeniden çözülür; CRC, geç paket ve sıra boşlukları görünür.\nBu kayıt sentetik bilgisayar testidir; fiziksel kart veya sensör kullanılmadı.'),
 ('mobile-replay-v18.png','04 / MOBİL KAYIT İNCELEMESİ','390 × 844 görünümde gerçek SITL kaydı; canlı uçuş komutları kilitli.\nEksik ölçüm boş kalır. Yazılım ve SITL kabulü, donanım kabulü değildir.'),
]
def main():
    WORK.mkdir(parents=True,exist_ok=True);parts=[]
    for index,(frame,title,caption) in enumerate(SCENES):
        (WORK/f'title-{index}.txt').write_text(title,encoding='utf-8')
        (WORK/f'caption-{index}.txt').write_text(caption,encoding='utf-8')
        output=WORK/f'part-{index}.mp4'
        filters=(f'scale=1920:900:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:60:color=0x0b121b,'
            f'drawtext=fontfile={FONT}:textfile={WORK}/title-{index}.txt:fontsize=26:fontcolor=0xa4e8c3:x=32:y=17,'
            f'drawtext=fontfile={FONT}:textfile={WORK}/caption-{index}.txt:fontsize=26:fontcolor=white:x=32:y=988:line_spacing=8')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-loop','1','-i',str(MEDIA/frame),'-vf',filters,'-t','6','-r','24','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p',str(output)],check=True)
        parts.append(f"file '{output}'")
    (WORK/'concat.txt').write_text('\n'.join(parts),encoding='utf-8')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(WORK/'concat.txt'),'-c','copy','-movflags','+faststart',str(MEDIA/'operations-v18.mp4')],check=True)

if __name__=='__main__':main()
