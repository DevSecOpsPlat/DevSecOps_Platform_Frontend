import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EnvironmentCreateComponent } from './environment-create.component';

describe('EnvironmentCreateComponent', () => {
  let component: EnvironmentCreateComponent;
  let fixture: ComponentFixture<EnvironmentCreateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EnvironmentCreateComponent]
    });
    fixture = TestBed.createComponent(EnvironmentCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
