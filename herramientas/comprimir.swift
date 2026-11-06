import Foundation
import AVFoundation

// uso: comprimir <entrada> <salida> <kbps> <fundido audio> [recortar a N segundos]
let a = CommandLine.arguments
guard a.count >= 5,
      let kbps = Int(a[3]), let fundido = Double(a[4]) else {
    FileHandle.standardError.write("uso: comprimir entrada salida kbps fundido [recorte]\n".data(using:.utf8)!)
    exit(64)
}
let recorte: Double? = a.count >= 6 ? Double(a[5]) : nil
let entrada = URL(fileURLWithPath: a[1])
let salida  = URL(fileURLWithPath: a[2])

let activo = AVURLAsset(url: entrada)
guard let pistaV = activo.tracks(withMediaType: .video).first else {
    FileHandle.standardError.write("sin pista de video\n".data(using:.utf8)!); exit(65)
}
let pistaA = activo.tracks(withMediaType: .audio).first
let durOriginal = CMTimeGetSeconds(activo.duration)
// recorte: quita el fotograma congelado del final
let dur = min(recorte ?? durOriginal, durOriginal)
let nat = pistaV.naturalSize

try? FileManager.default.removeItem(at: salida)

let lector: AVAssetReader
let escritor: AVAssetWriter
do {
    lector  = try AVAssetReader(asset: activo)
    escritor = try AVAssetWriter(outputURL: salida, fileType: .mp4)
} catch {
    FileHandle.standardError.write("no se pudo abrir: \(error)\n".data(using:.utf8)!); exit(66)
}
// mueve el índice al principio del archivo: el móvil empieza a reproducir sin bajarlo entero
escritor.shouldOptimizeForNetworkUse = true
if dur < durOriginal {
    lector.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: dur, preferredTimescale: 600))
}

// ── video ──
let salidaV = AVAssetReaderTrackOutput(track: pistaV, outputSettings: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
])
salidaV.alwaysCopiesSampleData = false
lector.add(salidaV)

let entradaV = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: Int(nat.width.rounded()),
    AVVideoHeightKey: Int(nat.height.rounded()),
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: kbps * 1000,
        AVVideoMaxKeyFrameIntervalKey: 48,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel,
        AVVideoAllowFrameReorderingKey: true,
    ] as [String: Any]
])
entradaV.expectsMediaDataInRealTime = false
entradaV.transform = pistaV.preferredTransform
escritor.add(entradaV)

// ── audio, con rampa de bajada al final para que no se corte en seco ──
var salidaA: AVAssetReaderAudioMixOutput?
var entradaA: AVAssetWriterInput?
if let pa = pistaA {
    let par = AVMutableAudioMixInputParameters(track: pa)
    if fundido > 0, dur > fundido {
        let desde = CMTime(seconds: dur - fundido, preferredTimescale: 600)
        par.setVolumeRamp(fromStartVolume: 1.0, toEndVolume: 0.0,
                          timeRange: CMTimeRange(start: desde,
                                                 duration: CMTime(seconds: fundido, preferredTimescale: 600)))
    }
    let mezcla = AVMutableAudioMix(); mezcla.inputParameters = [par]

    let sa = AVAssetReaderAudioMixOutput(audioTracks: [pa], audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ])
    sa.audioMix = mezcla
    lector.add(sa); salidaA = sa

    let ea = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVNumberOfChannelsKey: 2,
        AVSampleRateKey: 44100,
        AVEncoderBitRateKey: 128000,
    ])
    ea.expectsMediaDataInRealTime = false
    escritor.add(ea); entradaA = ea
}

guard escritor.startWriting() else {
    FileHandle.standardError.write("startWriting falló: \(String(describing: escritor.error))\n".data(using:.utf8)!); exit(67)
}
escritor.startSession(atSourceTime: .zero)
guard lector.startReading() else {
    FileHandle.standardError.write("startReading falló: \(String(describing: lector.error))\n".data(using:.utf8)!); exit(68)
}

let grupo = DispatchGroup()
grupo.enter()
entradaV.requestMediaDataWhenReady(on: DispatchQueue(label: "v")) {
    while entradaV.isReadyForMoreMediaData {
        if let m = salidaV.copyNextSampleBuffer() { entradaV.append(m) }
        else { entradaV.markAsFinished(); grupo.leave(); return }
    }
}
if let ea = entradaA, let sa = salidaA {
    grupo.enter()
    ea.requestMediaDataWhenReady(on: DispatchQueue(label: "a")) {
        while ea.isReadyForMoreMediaData {
            if let m = sa.copyNextSampleBuffer() { ea.append(m) }
            else { ea.markAsFinished(); grupo.leave(); return }
        }
    }
}

var codigo: Int32 = 0
let fin = DispatchSemaphore(value: 0)
grupo.notify(queue: .global()) {
    escritor.finishWriting {
        if escritor.status != .completed {
            FileHandle.standardError.write("error al escribir: \(String(describing: escritor.error))\n".data(using:.utf8)!)
            codigo = 69
        }
        fin.signal()
    }
}
fin.wait()
exit(codigo)
