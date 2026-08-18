from pydantic import  BaseModel


class ImageStats(BaseModel):
    shape: tuple[int, int, int]
    dtype : str
    mean : float
    std : float
    minimum : int
    maximum : int

class ChannelStatistics(BaseModel):
    mean: float
    std: float
    minimum: int
    maximum: int

class ChannelStats(BaseModel):
    red: ChannelStatistics
    green: ChannelStatistics
    blue: ChannelStatistics

class RegionHistogram(BaseModel):
    dark_pct : float
    mid_pct : float
    bright_pct : float

class HistogramStats(BaseModel):
    red: RegionHistogram
    green: RegionHistogram
    blue: RegionHistogram

class DominantColor(BaseModel):
    color: str
    rgb: tuple[int, int, int]
    percentage: float


class ImageReport(BaseModel):
    filename : str
    image_stats: ImageStats
    channel_stats: ChannelStats
    histogram: HistogramStats
    mean_brightness : float
    luminance_brightness: float
    contrast_score: float
    sharpness_score: float
    colorfulness_score: float
    underexposed_pct: float
    overexposed_pct: float
    entropy_score: float
    dominant_colors: list[DominantColor]
