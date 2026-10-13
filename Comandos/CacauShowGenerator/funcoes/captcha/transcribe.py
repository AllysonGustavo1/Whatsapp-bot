import os
import io
import sys
import subprocess
import speech_recognition as sr

def transcribe(audio_path):
    wav_path = audio_path
    temp_wav = None

    try:
        # Se for MP3, converte para WAV para compatibilidade universal (inclusive Ubuntu 20.04)
        if not audio_path.lower().endswith(".wav"):
            temp_wav = audio_path + ".wav"
            convertido = False

            # Método 1: ffmpeg
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", audio_path, temp_wav],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=15
                )
                if os.path.exists(temp_wav) and os.path.getsize(temp_wav) > 0:
                    wav_path = temp_wav
                    convertido = True
            except Exception:
                convertido = False

            # Método 2: soundfile (fallback caso ffmpeg não esteja instalado)
            if not convertido:
                try:
                    import soundfile as sf
                    data, samplerate = sf.read(audio_path)
                    sf.write(temp_wav, data, samplerate, format='WAV')
                    wav_path = temp_wav
                    convertido = True
                except Exception as e_sf:
                    sys.stderr.write(f"[Python] Falha ao converter MP3 via soundfile: {e_sf}\n")
                    wav_path = audio_path

        r = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)

        try:
            return r.recognize_google(audio, language="en-US")
        except Exception:
            return r.recognize_google(audio, language="pt-BR")

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
