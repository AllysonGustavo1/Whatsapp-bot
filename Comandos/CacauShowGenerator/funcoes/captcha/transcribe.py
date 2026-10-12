import soundfile as sf
import speech_recognition as sr
import io
import sys

def transcribe(mp3_path):
    try:
        data, samplerate = sf.read(mp3_path)
        wav_io = io.BytesIO()
        sf.write(wav_io, data, samplerate, format='WAV')
        wav_io.seek(0)

        r = sr.Recognizer()
        with sr.AudioFile(wav_io) as source:
            audio = r.record(source)

        try:
            return r.recognize_google(audio, language="en-US")
        except:
            return r.recognize_google(audio, language="pt-BR")
    except Exception as e:
        return ""

if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(transcribe(sys.argv[1]))
    else:
        print("")
