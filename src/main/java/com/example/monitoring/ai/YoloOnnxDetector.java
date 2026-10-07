package com.example.monitoring.ai;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.Closeable;
import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.Map;

/**
 * YOLO 检测模型 ONNX 推理封装（纯 Java，无需 Python）。
 *
 * 输入：RGB 浮点张量 [1,3,H,W]，像素已归一化到 0~1（letterbox 后填充灰边 114）。
 * 输出：Ultralytics 导出的检测张量，形状 [1, 4+numClasses, numAnchors]（通道在前）
 *       或 [1, numAnchors, 4+numClasses]（部分导出变体）。每行含义：
 *       [cx, cy, w, h, cls0, cls1, ...]（坐标均为输入像素尺度）。
 *
 * 本封装只关心「打架(violence)」类别的最高置信度，用于实时报警与视频时间轴打分。
 */
public class YoloOnnxDetector implements Closeable {

    private final OrtEnvironment env;
    private final OrtSession session;
    private final String inputName;
    private final String outputName;
    private final int inputSize;
    private final int fightClassIndex;
    private final float confThreshold;

    private volatile long[] outShape;

    private YoloOnnxDetector(OrtEnvironment env, OrtSession session, String inputName,
                             String outputName, int inputSize, int fightClassIndex, float confThreshold) {
        this.env = env;
        this.session = session;
        this.inputName = inputName;
        this.outputName = outputName;
        this.inputSize = inputSize;
        this.fightClassIndex = fightClassIndex;
        this.confThreshold = confThreshold;
    }

    public static YoloOnnxDetector load(String modelPath, int inputSize,
                                        int fightClassIndex, float confThreshold) throws OrtException {
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        OrtSession session = env.createSession(modelPath, opts);
        String inputName = session.getInputNames().iterator().next();
        String outputName = session.getOutputNames().iterator().next();
        return new YoloOnnxDetector(env, session, inputName, outputName,
                inputSize, fightClassIndex, confThreshold);
    }

    /** 对单帧做推理，返回该帧「打架」类别的最高置信度（无命中返回 0）。线程安全。 */
    public synchronized float detectBest(BufferedImage frame) {
        float[] input = preprocess(frame, inputSize);
        float[] out;
        try (OnnxTensor tensor = OnnxTensor.createTensor(
                env, FloatBuffer.wrap(input), new long[]{1, 3, inputSize, inputSize})) {
            Map<String, OnnxTensor> inputs = Collections.singletonMap(inputName, tensor);
            try (OrtSession.Result res = session.run(inputs)) {
                OnnxTensor ot = (OnnxTensor) res.get(outputName).orElseThrow();
                TensorInfo info = (TensorInfo) ot.getInfo();
                outShape = info.getShape();
                FloatBuffer fb = ot.getFloatBuffer();
                out = new float[fb.remaining()];
                fb.get(out);
            }
        } catch (OrtException e) {
            throw new RuntimeException("ONNX 推理失败", e);
        }
        return parseBestFightScore(out);
    }

    private float parseBestFightScore(float[] out) {
        long[] shape = outShape;
        if (shape == null || shape.length != 3) {
            return 0f;
        }
        int a = (int) shape[1];
        int b = (int) shape[2];
        // 判断布局：(C, N) 还是 (N, C)
        boolean channelFirst = b > a;
        int channels = channelFirst ? a : b;
        int anchors = channelFirst ? b : a;
        int numClasses = channels - 4;
        if (numClasses <= 0) {
            return 0f;
        }
        float best = 0f;
        for (int n = 0; n < anchors; n++) {
            float score = 0f;
            int clsId = -1;
            for (int c = 4; c < channels; c++) {
                float v = channelFirst ? out[c * anchors + n] : out[n * channels + c];
                if (v > score) {
                    score = v;
                    clsId = c - 4;
                }
            }
            if (clsId == fightClassIndex && score > best) {
                best = score;
            }
        }
        return best;
    }

    /** letterbox + 归一化，输出 CHW 浮点数组（RGB / 255）。 */
    private float[] preprocess(BufferedImage src, int size) {
        int w = src.getWidth();
        int h = src.getHeight();
        double scale = Math.min((double) size / w, (double) size / h);
        int nw = (int) Math.round(w * scale);
        int nh = (int) Math.round(h * scale);
        int padX = (size - nw) / 2;
        int padY = (size - nh) / 2;

        BufferedImage rgb = toRgb(src);
        BufferedImage canvas = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        g.setColor(new Color(114, 114, 114));
        g.fillRect(0, 0, size, size);
        Image scaled = rgb.getScaledInstance(nw, nh, Image.SCALE_AREA_AVERAGING);
        g.drawImage(scaled, padX, padY, null);
        g.dispose();

        float[] data = new float[3 * size * size];
        int plane = size * size;
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                int rgbVal = canvas.getRGB(x, y);
                int r = (rgbVal >> 16) & 0xff;
                int gg = (rgbVal >> 8) & 0xff;
                int b = rgbVal & 0xff;
                int idx = y * size + x;
                data[idx] = r / 255f;
                data[plane + idx] = gg / 255f;
                data[2 * plane + idx] = b / 255f;
            }
        }
        return data;
    }

    private static BufferedImage toRgb(BufferedImage img) {
        if (img.getType() == BufferedImage.TYPE_INT_RGB) {
            return img;
        }
        BufferedImage out = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.drawImage(img, 0, 0, null);
        g.dispose();
        return out;
    }

    public int getInputSize() {
        return inputSize;
    }

    @Override
    public void close() {
        try {
            session.close();
        } catch (OrtException ignored) {
        }
    }
}
