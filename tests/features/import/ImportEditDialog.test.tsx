/**
 * 单文件导入编辑框组件测试：预填标题、编辑后确认提交、取消不提交。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImportEditDialog from '@/features/import/ImportEditDialog';

describe('ImportEditDialog 单文件导入编辑框', () => {
  it('预填文件名兜底标题，确认时提交编辑后的标题/说明/备注', () => {
    const onConfirm = vi.fn();
    render(
      <ImportEditDialog
        fileName="机场东路有氧.fit"
        defaultTitle="机场东路有氧"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('group', { name: '导入活动信息' })).toBeDefined();
    expect((screen.getByLabelText('活动标题') as HTMLInputElement).value).toBe('机场东路有氧');

    fireEvent.change(screen.getByLabelText('活动标题'), { target: { value: '机场东路晨骑' } });
    fireEvent.change(screen.getByLabelText('活动说明'), { target: { value: '测试说明' } });
    fireEvent.change(screen.getByLabelText('个人备注'), { target: { value: '测试备注' } });
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    expect(onConfirm).toHaveBeenCalledWith({ title: '机场东路晨骑', description: '测试说明', note: '测试备注' });
  });

  it('取消按钮不提交', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ImportEditDialog
        fileName="ride.fit"
        defaultTitle=""
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});