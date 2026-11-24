import os
import io
import sys
import subprocess

def transcribe(audio_path):
    wav_path = audio_path
    temp_wav = None

    try:
        # Se for MP3, converte para WAV para compatibilidade universal
        if not audio_path.lower().endswith(".wav"):
            temp_wav = audio_path + ".wav"
            convertido = False

            # Método 1: ffmpeg (preferencial)
            try:
                result = subprocess.run(
                    ["ffmpeg", "-y", "-i", audio_path, temp_wav],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15
                )
                if result.returncode == 0 and os.path.exists(temp_wav) and os.path.getsize(temp_wav) > 0:
                    wav_path = temp_wav
                    convertido = True
                    sys.stderr.write("[Python] Áudio convertido via ffmpeg\n")
            except Exception as e_ffmpeg:
                sys.stderr.write(f"[Python] ffmpeg falhou: {e_ffmpeg}\n")

            # Método 2: soundfile (fallback caso ffmpeg não esteja instalado)
            if not convertido:
                try:
                    import soundfile as sf
                    data, samplerate = sf.read(audio_path)
                    sf.write(temp_wav, data, samplerate, format='WAV')
                    wav_path = temp_wav
                    convertido = True
                    sys.stderr.write("[Python] Áudio convertido via soundfile\n")
                except Exception as e_sf:
                    sys.stderr.write(f"[Python] soundfile falhou: {e_sf}\n")
                    wav_path = audio_path

        # Usa speech_recognition para transcodificar
        import speech_recognition as sr
        r = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)

        try:
            return r.recognize_google(audio, language="pt-BR")
        except Exception as e_en:
            sys.stderr.write(f"[Python] Reconhecimento en-US falhou: {e_en}\n")
            try:
                return r.recognize_google(audio, language="en-US")
            except Exception as e_us:
                sys.stderr.write(f"[Python] Reconhecimento en-US também falhou: {e_us}\n")
                return ""

    except Exception as e:
        sys.stderr.write(f"[Python] Erro na transcrição de áudio: {e}\n")
        return ""
    finally:
        if temp_wav and os.path.exists(temp_wav):
            try:
                os.remove(temp_wav)
            except Exception:
                pass

if __name__ == "__main__":
    if len(sys.argv) > 1:
        resultado = transcribe(sys.argv[1])
        print(resultado)
    else:
        print("")
