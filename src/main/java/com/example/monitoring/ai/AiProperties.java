package com.example.monitoring.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 纯 Java 推理相关配置（application.yml 的 app.ai.*） */
@Component
@ConfigurationProperties(prefix = "app.ai")
public class AiProperties {

    private boolean enabled = true;
    /** ONNX 权重路径；留空则按「启用模型 .pt」同级推导为 .onnx */
    private String onnxPath = "";
    private int inputSize = 640;
    private double confThreshold = 0.5;
    /** 模型类别中 violence 的下标（0=non_violence, 1=violence） */
    private int fightClassIndex = 1;
    /** 实时拉流每 N 帧推理一次 */
    private int frameSkip = 3;
    /** 同一摄像头两次报警最小间隔（秒） */
    private int cooldownSeconds = 30;
    /** 重新拉取摄像头列表 / 启用模型的间隔（秒） */
    private int pollIntervalSeconds = 30;
    private int heartbeatIntervalSeconds = 15;
    /** 上传视频抽帧目标帧率 */
    private int sampleFps = 5;
    /** 上传视频最大抽帧数（长视频上限） */
    private int maxVideoFrames = 3000;
    /** 预览转码：输出最大宽度（预览不需要原始分辨率，越小越快） */
    private int previewMaxWidth = 640;
    /** 预览转码：输出帧率 */
    private int previewFps = 12;
    /** 预览转码：视频码率 */
    private int previewVideoBitrate = 900_000;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public String getOnnxPath() { return onnxPath; }
    public void setOnnxPath(String onnxPath) { this.onnxPath = onnxPath; }

    public int getInputSize() { return inputSize; }
    public void setInputSize(int inputSize) { this.inputSize = inputSize; }

    public double getConfThreshold() { return confThreshold; }
    public void setConfThreshold(double confThreshold) { this.confThreshold = confThreshold; }

    public int getFightClassIndex() { return fightClassIndex; }
    public void setFightClassIndex(int fightClassIndex) { this.fightClassIndex = fightClassIndex; }

    public int getFrameSkip() { return frameSkip; }
    public void setFrameSkip(int frameSkip) { this.frameSkip = frameSkip; }

    public int getCooldownSeconds() { return cooldownSeconds; }
    public void setCooldownSeconds(int cooldownSeconds) { this.cooldownSeconds = cooldownSeconds; }

    public int getPollIntervalSeconds() { return pollIntervalSeconds; }
    public void setPollIntervalSeconds(int pollIntervalSeconds) { this.pollIntervalSeconds = pollIntervalSeconds; }

    public int getHeartbeatIntervalSeconds() { return heartbeatIntervalSeconds; }
    public void setHeartbeatIntervalSeconds(int heartbeatIntervalSeconds) { this.heartbeatIntervalSeconds = heartbeatIntervalSeconds; }

    public int getSampleFps() { return sampleFps; }
    public void setSampleFps(int sampleFps) { this.sampleFps = sampleFps; }

    public int getMaxVideoFrames() { return maxVideoFrames; }
    public void setMaxVideoFrames(int maxVideoFrames) { this.maxVideoFrames = maxVideoFrames; }

    public int getPreviewMaxWidth() { return previewMaxWidth; }
    public void setPreviewMaxWidth(int previewMaxWidth) { this.previewMaxWidth = previewMaxWidth; }

    public int getPreviewFps() { return previewFps; }
    public void setPreviewFps(int previewFps) { this.previewFps = previewFps; }

    public int getPreviewVideoBitrate() { return previewVideoBitrate; }
    public void setPreviewVideoBitrate(int previewVideoBitrate) { this.previewVideoBitrate = previewVideoBitrate; }
}
